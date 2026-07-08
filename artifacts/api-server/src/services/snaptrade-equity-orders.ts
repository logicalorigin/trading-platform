import { and, eq } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import {
  buildSnapTradeSignature,
  SNAPTRADE_API_BASE_URL,
} from "./snaptrade-readiness";
import { loadSnapTradeUserCredential } from "./snaptrade-user-custody";
import {
  assertTaxPreflightForOrderSubmission,
  recordTaxPreflightOrderSubmitted,
} from "./tax-planning";
import type { TaxOrderLike } from "./tax-planning-model";
import { readEnvString } from "../lib/env";

export const SNAPTRADE_EQUITY_ORDER_ACTIONS = ["BUY", "SELL"] as const;
export const SNAPTRADE_EQUITY_ORDER_TYPES = [
  "Market",
  "Limit",
  "Stop",
  "StopLimit",
] as const;
export const SNAPTRADE_EQUITY_TIME_IN_FORCE_VALUES = [
  "Day",
  "GTC",
  "FOK",
  "IOC",
] as const;
export const SNAPTRADE_EQUITY_TRADING_SESSIONS = [
  "REGULAR",
  "EXTENDED",
] as const;

export type SnapTradeEquityOrderAction =
  (typeof SNAPTRADE_EQUITY_ORDER_ACTIONS)[number];
export type SnapTradeEquityOrderType =
  (typeof SNAPTRADE_EQUITY_ORDER_TYPES)[number];
export type SnapTradeEquityTimeInForce =
  (typeof SNAPTRADE_EQUITY_TIME_IN_FORCE_VALUES)[number];
export type SnapTradeEquityTradingSession =
  (typeof SNAPTRADE_EQUITY_TRADING_SESSIONS)[number];

export type SnapTradeEquityOrderImpactInput = {
  action: SnapTradeEquityOrderAction;
  universalSymbolId: string;
  symbol?: string | null;
  orderType: SnapTradeEquityOrderType;
  timeInForce: SnapTradeEquityTimeInForce;
  units?: number | null;
  notionalValue?: number | null;
  price?: number | null;
  stop?: number | null;
};

export type SnapTradeEquityOrderSubmitInput = {
  confirm?: boolean;
  action: SnapTradeEquityOrderAction;
  symbol: string;
  orderType: SnapTradeEquityOrderType;
  timeInForce: SnapTradeEquityTimeInForce;
  tradingSession?: SnapTradeEquityTradingSession | null;
  expiryDate?: string | null;
  units?: number | null;
  notionalValue?: number | null;
  price?: number | null;
  stop?: number | null;
  clientOrderId?: string | null;
  taxPreflightToken?: string | null;
  taxAcknowledgements?: string[] | null;
};

export type SnapTradeEquityOrderAccount = {
  id: string;
  connectionId: string;
  snapTradeAccountId: string;
  displayName: string;
  baseCurrency: string;
  mode: "live";
  accountStatus: string | null;
  executionReady: boolean;
  executionBlockers: string[];
  lastSyncedAt: string | null;
};

export type SnapTradeEquityOrderDetails = {
  action: SnapTradeEquityOrderAction;
  symbol: string | null;
  universalSymbolId: string | null;
  orderType: SnapTradeEquityOrderType;
  timeInForce: SnapTradeEquityTimeInForce;
  tradingSession: SnapTradeEquityTradingSession | null;
  units: number | null;
  notionalValue: number | null;
  price: number | null;
  stop: number | null;
  clientOrderId: string | null;
};

export type SnapTradeEquityOrderImpactResponse = {
  provider: "snaptrade";
  checkedAt: string;
  account: SnapTradeEquityOrderAccount;
  order: SnapTradeEquityOrderDetails;
  trade: {
    id: string;
    expiresAt: string;
  };
  impact: {
    remainingCash: number | null;
    estimatedCommission: number | null;
    forexFees: number | null;
  };
};

export type SnapTradeEquityOrderSubmitResponse = {
  provider: "snaptrade";
  submittedAt: string;
  account: SnapTradeEquityOrderAccount;
  order: SnapTradeEquityOrderDetails & {
    brokerageOrderId: string | null;
    status: string;
  };
};

export type SnapTradeRecentOrder = {
  brokerageOrderId: string | null;
  brokerageGroupOrderId: string | null;
  orderRole: string | null;
  status: string;
  symbol: string | null;
  rawSymbol: string | null;
  description: string | null;
  universalSymbolId: string | null;
  optionSymbolId: string | null;
  optionTicker: string | null;
  action: string | null;
  totalQuantity: number | null;
  openQuantity: number | null;
  canceledQuantity: number | null;
  filledQuantity: number | null;
  executionPrice: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
  orderType: string | null;
  timeInForce: string | null;
  timePlaced: string | null;
  timeUpdated: string | null;
  timeExecuted: string | null;
  expiryDate: string | null;
};

export type SnapTradeRecentOrdersResponse = {
  provider: "snaptrade";
  checkedAt: string;
  account: SnapTradeEquityOrderAccount;
  orders: SnapTradeRecentOrder[];
};

export type SnapTradeAccountSymbol = {
  id: string;
  symbol: string;
  rawSymbol: string | null;
  description: string | null;
  currencyCode: string | null;
  exchangeCode: string | null;
  exchangeMicCode: string | null;
  exchangeName: string | null;
  exchangeSuffix: string | null;
  securityTypeCode: string | null;
  securityTypeDescription: string | null;
};

export type SnapTradeAccountSymbolSearchResponse = {
  provider: "snaptrade";
  checkedAt: string;
  query: string;
  account: SnapTradeEquityOrderAccount;
  symbols: SnapTradeAccountSymbol[];
  bestMatch: SnapTradeAccountSymbol | null;
};

export type CheckSnapTradeEquityOrderImpactOptions = {
  appUserId: string;
  accountId: string;
  input: SnapTradeEquityOrderImpactInput;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
};

export type SubmitSnapTradeEquityOrderOptions = {
  appUserId: string;
  accountId: string;
  input: SnapTradeEquityOrderSubmitInput;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
};

export type ListSnapTradeRecentOrdersOptions = {
  appUserId: string;
  accountId: string;
  includeNonExecuted?: boolean;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
};

export type SearchSnapTradeAccountSymbolsOptions = {
  appUserId: string;
  accountId: string;
  query: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
};

type SnapTradeCredentials = {
  clientId: string;
  consumerKey: string;
};

type LocalSnapTradeAccount = SnapTradeEquityOrderAccount & {
  capabilities: string[];
};

type NormalizedOrderQuantity = {
  units: number | null;
  notionalValue: number | null;
};

type NormalizedOrderPrices = {
  price: number | null;
  stop: number | null;
};

type NormalizedImpactInput = Required<
  Pick<
    SnapTradeEquityOrderImpactInput,
    "action" | "universalSymbolId" | "orderType" | "timeInForce"
  >
> &
  NormalizedOrderQuantity &
  NormalizedOrderPrices & {
    symbol: string | null;
  };

type NormalizedSubmitInput = Required<
  Pick<
    SnapTradeEquityOrderSubmitInput,
    "action" | "symbol" | "orderType" | "timeInForce"
  >
> &
  NormalizedOrderQuantity &
  NormalizedOrderPrices & {
    tradingSession: SnapTradeEquityTradingSession;
    expiryDate: string | null;
    clientOrderId: string | null;
  };

const LOCAL_ID_PREFIX = "snaptrade:";
const SNAPTRADE_ORDER_IMPACT_PATH = "/trade/impact";
const SNAPTRADE_PLACE_EQUITY_ORDER_PATH = "/trade/place";
const SNAPTRADE_TRADE_EXPIRY_MS = 5 * 60 * 1000;
const SNAPTRADE_MIN_ORDER_INTERVAL_MS = 1000;
const SNAPTRADE_SYMBOL_SEARCH_MAX_LENGTH = 80;
const SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TAX_ORDER_TYPE_BY_SNAPTRADE: Record<SnapTradeEquityOrderType, TaxOrderLike["type"]> = {
  Market: "market",
  Limit: "limit",
  Stop: "stop",
  StopLimit: "stop_limit",
};

const TAX_TIF_BY_SNAPTRADE: Record<SnapTradeEquityTimeInForce, TaxOrderLike["timeInForce"]> = {
  Day: "day",
  GTC: "gtc",
  FOK: "fok",
  IOC: "ioc",
};
const ACTIONS = new Set<string>(SNAPTRADE_EQUITY_ORDER_ACTIONS);
const ORDER_TYPES = new Set<string>(SNAPTRADE_EQUITY_ORDER_TYPES);
const TIME_IN_FORCE_VALUES = new Set<string>(
  SNAPTRADE_EQUITY_TIME_IN_FORCE_VALUES,
);
const TRADING_SESSIONS = new Set<string>(SNAPTRADE_EQUITY_TRADING_SESSIONS);
const lastSubmitAtByAccountKey = new Map<string, number>();

function configuredSnapTradeCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): SnapTradeCredentials {
  const clientId = readEnvString(env, "SNAPTRADE_CLIENTID");
  const consumerKey = readEnvString(env, "SNAPTRADE_API_KEY");
  if (!clientId || !consumerKey) {
    throw new HttpError(503, "SnapTrade credentials are not configured", {
      code: "snaptrade_credentials_not_configured",
    });
  }
  return { clientId, consumerKey };
}

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

function readNestedString(
  record: Record<string, unknown>,
  path: string[],
): string | null {
  let value: unknown = record;
  for (const key of path) {
    value = asRecord(value)[key];
  }
  return nonEmptyString(value);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function buildUserScopedQuery(input: {
  clientId: string;
  timestamp: string;
  snapTradeUserId: string;
  userSecret: string;
  extra?: Record<string, string | number | boolean | null | undefined>;
}): string {
  const query = new URLSearchParams();
  query.set("clientId", input.clientId);
  query.set("timestamp", input.timestamp);
  query.set("userId", input.snapTradeUserId);
  query.set("userSecret", input.userSecret);
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    if (value !== null && value !== undefined) {
      query.set(key, String(value));
    }
  }
  return query.toString();
}

async function getSnapTradeJson(input: {
  path: string;
  query: string;
  consumerKey: string;
  fetchImpl: typeof fetch;
  message: string;
  networkCode: string;
  failedCode: string;
}): Promise<unknown> {
  const { signature } = buildSnapTradeSignature({
    path: input.path,
    query: input.query,
    content: null,
    consumerKey: input.consumerKey,
  });

  let response: Response;
  let payload: unknown;
  try {
    response = await input.fetchImpl(
      `${SNAPTRADE_API_BASE_URL}${input.path}?${input.query}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Signature: signature,
        },
      },
    );
    payload = await readJsonSafely(response);
  } catch {
    throw new HttpError(502, input.message, {
      code: input.networkCode,
      expose: false,
    });
  }

  if (!response.ok) {
    throw new HttpError(502, input.message, {
      code: input.failedCode,
      expose: false,
      data: { path: input.path, status: response.status },
    });
  }

  return payload;
}

async function postSnapTradeJson(input: {
  path: string;
  query: string;
  content: Record<string, unknown>;
  consumerKey: string;
  fetchImpl: typeof fetch;
  message: string;
  networkCode: string;
  failedCode: string;
}): Promise<unknown> {
  const { signature } = buildSnapTradeSignature({
    path: input.path,
    query: input.query,
    content: input.content,
    consumerKey: input.consumerKey,
  });

  let response: Response;
  let payload: unknown;
  try {
    response = await input.fetchImpl(
      `${SNAPTRADE_API_BASE_URL}${input.path}?${input.query}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Signature: signature,
        },
        body: JSON.stringify(input.content),
      },
    );
    payload = await readJsonSafely(response);
  } catch {
    throw new HttpError(502, input.message, {
      code: input.networkCode,
      expose: false,
    });
  }

  if (!response.ok) {
    throw new HttpError(502, input.message, {
      code: input.failedCode,
      expose: false,
      data: { path: input.path, status: response.status },
    });
  }

  return payload;
}

function snapTradeAccountIdFromProviderAccountId(value: string): string | null {
  return value.startsWith(LOCAL_ID_PREFIX)
    ? value.slice(LOCAL_ID_PREFIX.length).trim() || null
    : null;
}

function executionReady(input: {
  capabilities: string[];
  executionBlockers: string[];
  accountStatus: string | null;
}): boolean {
  return (
    input.capabilities.includes("execution-ready") &&
    input.executionBlockers.length === 0 &&
    (input.accountStatus == null || input.accountStatus === "open")
  );
}

async function loadLocalSnapTradeAccount(
  appUserId: string,
  accountId: string,
): Promise<LocalSnapTradeAccount> {
  const [row] = await db
    .select({
      id: brokerAccountsTable.id,
      connectionId: brokerAccountsTable.connectionId,
      providerAccountId: brokerAccountsTable.providerAccountId,
      displayName: brokerAccountsTable.displayName,
      baseCurrency: brokerAccountsTable.baseCurrency,
      mode: brokerAccountsTable.mode,
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
        eq(brokerConnectionsTable.brokerProvider, "snaptrade"),
        eq(brokerAccountsTable.mode, "live"),
      ),
    )
    .limit(1);

  const snapTradeAccountId = row
    ? snapTradeAccountIdFromProviderAccountId(row.providerAccountId)
    : null;
  if (!row || !snapTradeAccountId) {
    throw new HttpError(404, "SnapTrade account was not found", {
      code: "snaptrade_account_not_found",
    });
  }

  const capabilities = [...row.capabilities];
  const executionBlockers = [...row.executionBlockers];
  return {
    id: row.id,
    connectionId: row.connectionId,
    snapTradeAccountId,
    displayName: row.displayName,
    baseCurrency: row.baseCurrency,
    mode: "live",
    accountStatus: row.accountStatus,
    capabilities,
    executionBlockers,
    executionReady: executionReady({
      capabilities,
      executionBlockers,
      accountStatus: row.accountStatus,
    }),
    lastSyncedAt: row.lastSyncedAt,
  };
}

function publicAccount(account: LocalSnapTradeAccount): SnapTradeEquityOrderAccount {
  return {
    id: account.id,
    connectionId: account.connectionId,
    snapTradeAccountId: account.snapTradeAccountId,
    displayName: account.displayName,
    baseCurrency: account.baseCurrency,
    mode: account.mode,
    accountStatus: account.accountStatus,
    executionReady: account.executionReady,
    executionBlockers: account.executionBlockers,
    lastSyncedAt: account.lastSyncedAt,
  };
}

function assertExecutionReady(account: LocalSnapTradeAccount): void {
  if (account.executionReady) {
    return;
  }

  const blockers = account.executionBlockers.length
    ? account.executionBlockers
    : [
        account.capabilities.includes("execution-ready")
          ? "account_status_not_open"
          : "execution_ready_capability_missing",
      ];
  throw new HttpError(409, "SnapTrade account is not execution-ready", {
    code: "snaptrade_account_execution_blocked",
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

function normalizeSymbol(value: string | null | undefined): string | null {
  const symbol = value?.trim();
  if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
    return null;
  }
  return symbol.toUpperCase();
}

function requireSymbol(value: string | null | undefined): string {
  const symbol = normalizeSymbol(value);
  if (!symbol) {
    throw new HttpError(422, "SnapTrade order symbol is invalid", {
      code: "snaptrade_order_symbol_invalid",
    });
  }
  return symbol;
}

function requireUniversalSymbolId(value: string | null | undefined): string {
  const universalSymbolId = value?.trim();
  if (!universalSymbolId || !UUID_PATTERN.test(universalSymbolId)) {
    throw new HttpError(422, "SnapTrade universal symbol id is invalid", {
      code: "snaptrade_universal_symbol_id_invalid",
    });
  }
  return universalSymbolId;
}

function requireSymbolSearchQuery(value: string | null | undefined): string {
  const query = value?.trim();
  if (!query) {
    throw new HttpError(422, "SnapTrade symbol search query is required", {
      code: "snaptrade_symbol_search_query_required",
    });
  }
  if (query.length > SNAPTRADE_SYMBOL_SEARCH_MAX_LENGTH) {
    throw new HttpError(422, "SnapTrade symbol search query is too long", {
      code: "snaptrade_symbol_search_query_too_long",
    });
  }
  return query.toUpperCase();
}

function normalizeOptionalUuid(
  value: string | null | undefined,
  code: string,
  message: string,
): string | null {
  const uuid = value?.trim();
  if (!uuid) {
    return null;
  }
  if (!UUID_PATTERN.test(uuid)) {
    throw new HttpError(422, message, { code });
  }
  return uuid;
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

function normalizeQuantity(input: {
  units?: number | null;
  notionalValue?: number | null;
  orderType: SnapTradeEquityOrderType;
  timeInForce: SnapTradeEquityTimeInForce;
}): NormalizedOrderQuantity {
  const units = positiveNumberOrNull(
    input.units,
    "snaptrade_order_units_invalid",
    "SnapTrade order units must be positive",
  );
  const notionalValue = positiveNumberOrNull(
    input.notionalValue,
    "snaptrade_order_notional_value_invalid",
    "SnapTrade order notional value must be positive",
  );

  if ((units == null && notionalValue == null) || (units != null && notionalValue != null)) {
    throw new HttpError(
      422,
      "SnapTrade order must specify exactly one quantity type",
      { code: "snaptrade_order_quantity_invalid" },
    );
  }

  if (
    notionalValue != null &&
    (input.orderType !== "Market" || input.timeInForce !== "Day")
  ) {
    throw new HttpError(
      422,
      "SnapTrade notional orders require Market order type and Day time in force",
      { code: "snaptrade_order_notional_unsupported" },
    );
  }

  return { units, notionalValue };
}

function normalizePrices(input: {
  orderType: SnapTradeEquityOrderType;
  price?: number | null;
  stop?: number | null;
}): NormalizedOrderPrices {
  const price = positiveNumberOrNull(
    input.price,
    "snaptrade_order_price_invalid",
    "SnapTrade order price must be positive",
  );
  const stop = positiveNumberOrNull(
    input.stop,
    "snaptrade_order_stop_invalid",
    "SnapTrade order stop must be positive",
  );

  if ((input.orderType === "Limit" || input.orderType === "StopLimit") && price == null) {
    throw new HttpError(422, "SnapTrade limit orders require a price", {
      code: "snaptrade_order_price_required",
    });
  }
  if ((input.orderType === "Stop" || input.orderType === "StopLimit") && stop == null) {
    throw new HttpError(422, "SnapTrade stop orders require a stop price", {
      code: "snaptrade_order_stop_required",
    });
  }

  return { price, stop };
}

function normalizeImpactInput(
  input: SnapTradeEquityOrderImpactInput,
): NormalizedImpactInput {
  const action = assertEnum<SnapTradeEquityOrderAction>(
    input.action,
    ACTIONS,
    "snaptrade_order_action_invalid",
    "SnapTrade order action is invalid",
  );
  const orderType = assertEnum<SnapTradeEquityOrderType>(
    input.orderType,
    ORDER_TYPES,
    "snaptrade_order_type_invalid",
    "SnapTrade order type is invalid",
  );
  const timeInForce = assertEnum<SnapTradeEquityTimeInForce>(
    input.timeInForce,
    TIME_IN_FORCE_VALUES,
    "snaptrade_order_time_in_force_invalid",
    "SnapTrade order time in force is invalid",
  );
  return {
    action,
    universalSymbolId: requireUniversalSymbolId(input.universalSymbolId),
    symbol: normalizeSymbol(input.symbol),
    orderType,
    timeInForce,
    ...normalizeQuantity({
      units: input.units,
      notionalValue: input.notionalValue,
      orderType,
      timeInForce,
    }),
    ...normalizePrices({
      orderType,
      price: input.price,
      stop: input.stop,
    }),
  };
}

function normalizeSubmitInput(
  input: SnapTradeEquityOrderSubmitInput,
): NormalizedSubmitInput {
  const action = assertEnum<SnapTradeEquityOrderAction>(
    input.action,
    ACTIONS,
    "snaptrade_order_action_invalid",
    "SnapTrade order action is invalid",
  );
  const orderType = assertEnum<SnapTradeEquityOrderType>(
    input.orderType,
    ORDER_TYPES,
    "snaptrade_order_type_invalid",
    "SnapTrade order type is invalid",
  );
  const timeInForce = assertEnum<SnapTradeEquityTimeInForce>(
    input.timeInForce,
    TIME_IN_FORCE_VALUES,
    "snaptrade_order_time_in_force_invalid",
    "SnapTrade order time in force is invalid",
  );
  const tradingSession = assertEnum<SnapTradeEquityTradingSession>(
    input.tradingSession ?? "REGULAR",
    TRADING_SESSIONS,
    "snaptrade_order_trading_session_invalid",
    "SnapTrade order trading session is invalid",
  );
  if (tradingSession === "EXTENDED" && orderType !== "Limit") {
    throw new HttpError(422, "SnapTrade extended-hours orders require Limit", {
      code: "snaptrade_order_extended_hours_invalid",
    });
  }

  return {
    action,
    symbol: requireSymbol(input.symbol),
    orderType,
    timeInForce,
    tradingSession,
    expiryDate: input.expiryDate?.trim() || null,
    clientOrderId: normalizeOptionalUuid(
      input.clientOrderId,
      "snaptrade_client_order_id_invalid",
      "SnapTrade client order id is invalid",
    ),
    ...normalizeQuantity({
      units: input.units,
      notionalValue: input.notionalValue,
      orderType,
      timeInForce,
    }),
    ...normalizePrices({
      orderType,
      price: input.price,
      stop: input.stop,
    }),
  };
}

function snapTradeSubmitToTaxOrder(input: {
  accountId: string;
  order: NormalizedSubmitInput;
}): TaxOrderLike {
  return {
    accountId: input.accountId,
    mode: "live",
    symbol: input.order.symbol,
    assetClass: "equity",
    side: input.order.action === "SELL" ? "sell" : "buy",
    type: TAX_ORDER_TYPE_BY_SNAPTRADE[input.order.orderType],
    quantity: Number(input.order.units) || 0,
    limitPrice: input.order.price ?? null,
    stopPrice: input.order.stop ?? null,
    timeInForce: TAX_TIF_BY_SNAPTRADE[input.order.timeInForce],
    optionContract: null,
    route: "snaptrade",
    intent: null,
  };
}

function impactContent(
  account: LocalSnapTradeAccount,
  input: NormalizedImpactInput,
): Record<string, unknown> {
  return {
    account_id: account.snapTradeAccountId,
    action: input.action,
    universal_symbol_id: input.universalSymbolId,
    order_type: input.orderType,
    time_in_force: input.timeInForce,
    price: input.price,
    stop: input.stop,
    units: input.units,
    notional_value: input.notionalValue,
  };
}

function submitContent(
  account: LocalSnapTradeAccount,
  input: NormalizedSubmitInput,
): Record<string, unknown> {
  return {
    account_id: account.snapTradeAccountId,
    action: input.action,
    universal_symbol_id: null,
    symbol: input.symbol,
    order_type: input.orderType,
    time_in_force: input.timeInForce,
    trading_session: input.tradingSession,
    expiry_date: input.expiryDate,
    price: input.price,
    stop: input.stop,
    units: input.units,
    notional_value: input.notionalValue,
    client_order_id: input.clientOrderId,
  };
}

function orderDetails(
  input: NormalizedImpactInput | NormalizedSubmitInput,
  symbol: string | null,
  universalSymbolId: string | null,
): SnapTradeEquityOrderDetails {
  return {
    action: input.action,
    symbol,
    universalSymbolId,
    orderType: input.orderType,
    timeInForce: input.timeInForce,
    tradingSession: "tradingSession" in input ? input.tradingSession : null,
    units: input.units,
    notionalValue: input.notionalValue,
    price: input.price,
    stop: input.stop,
    clientOrderId: "clientOrderId" in input ? input.clientOrderId : null,
  };
}

function parseImpactResponse(
  payload: unknown,
  input: NormalizedImpactInput,
  now: Date,
): Omit<SnapTradeEquityOrderImpactResponse, "provider" | "checkedAt" | "account"> {
  const record = asRecord(payload);
  const trade = asRecord(record["trade"]);
  const tradeId = readString(trade, ["id"]);
  if (!tradeId) {
    throw new HttpError(502, "SnapTrade order impact returned invalid data", {
      code: "snaptrade_order_impact_invalid_response",
      expose: false,
    });
  }

  const symbolRecord = asRecord(trade["symbol"]);
  const symbol =
    readString(symbolRecord, ["symbol", "raw_symbol", "rawSymbol"]) ??
    input.symbol;
  const impact = Array.isArray(record["trade_impacts"])
    ? asRecord(record["trade_impacts"][0])
    : {};
  const combinedRemainingBalance = asRecord(
    record["combined_remaining_balance"] ?? record["combinedRemainingBalance"],
  );

  return {
    order: orderDetails(
      input,
      symbol,
      readString(symbolRecord, [
        "universal_symbol_id",
        "universalSymbolId",
        "id",
      ]) ?? input.universalSymbolId,
    ),
    trade: {
      id: tradeId,
      expiresAt: new Date(now.getTime() + SNAPTRADE_TRADE_EXPIRY_MS).toISOString(),
    },
    impact: {
      remainingCash:
        numberOrNull(combinedRemainingBalance["cash"]) ??
        numberOrNull(impact["remaining_cash"]),
      estimatedCommission: numberOrNull(impact["estimated_commission"]),
      forexFees: numberOrNull(impact["forex_fees"]),
    },
  };
}

function parseSubmitResponse(
  payload: unknown,
  input: NormalizedSubmitInput,
): Omit<SnapTradeEquityOrderSubmitResponse, "provider" | "submittedAt" | "account"> {
  const record = Array.isArray(payload) ? asRecord(payload[0]) : asRecord(payload);
  const status = readString(record, ["status"]);
  if (!status) {
    throw new HttpError(502, "SnapTrade equity order returned invalid data", {
      code: "snaptrade_order_submit_invalid_response",
      expose: false,
    });
  }

  return {
    order: {
      ...orderDetails(
        input,
        readNestedString(record, ["universal_symbol", "symbol"]) ??
          readNestedString(record, ["universalSymbol", "symbol"]) ??
          readString(record, ["symbol", "raw_symbol", "rawSymbol"]) ??
          input.symbol,
        readNestedString(record, ["universal_symbol", "id"]) ??
          readNestedString(record, ["universalSymbol", "id"]),
      ),
      brokerageOrderId: readString(record, [
        "brokerage_order_id",
        "brokerageOrderId",
      ]),
      status,
    },
  };
}

function parseRecentOrdersPayload(payload: unknown): SnapTradeRecentOrder[] {
  const record = asRecord(payload);
  const orders = Array.isArray(record["orders"])
    ? record["orders"]
    : Array.isArray(payload)
      ? payload
      : null;
  if (!orders) {
    throw new HttpError(502, "SnapTrade recent orders returned invalid data", {
      code: "snaptrade_recent_orders_invalid_response",
      expose: false,
    });
  }

  return orders.map((order) => {
    const orderRecord = asRecord(order);
    const universalSymbol = asRecord(
      orderRecord["universal_symbol"] ?? orderRecord["universalSymbol"],
    );
    const optionSymbol = asRecord(
      orderRecord["option_symbol"] ?? orderRecord["optionSymbol"],
    );
    return {
      brokerageOrderId: readString(orderRecord, [
        "brokerage_order_id",
        "brokerageOrderId",
      ]),
      brokerageGroupOrderId: readString(orderRecord, [
        "brokerage_group_order_id",
        "brokerageGroupOrderId",
      ]),
      orderRole: readString(orderRecord, ["order_role", "orderRole"]),
      status: readString(orderRecord, ["status"]) ?? "UNKNOWN",
      symbol:
        readString(universalSymbol, ["symbol"]) ??
        readString(orderRecord, ["symbol"]),
      rawSymbol:
        readString(universalSymbol, ["raw_symbol", "rawSymbol"]) ??
        readString(orderRecord, ["raw_symbol", "rawSymbol"]),
      description:
        readString(universalSymbol, ["description"]) ??
        readString(orderRecord, ["description"]),
      universalSymbolId: readString(universalSymbol, ["id"]),
      optionSymbolId: readString(optionSymbol, ["id"]),
      optionTicker: readString(optionSymbol, ["ticker", "symbol"]),
      action: readString(orderRecord, ["action"]),
      totalQuantity: numberOrNull(
        orderRecord["total_quantity"] ?? orderRecord["totalQuantity"],
      ),
      openQuantity: numberOrNull(
        orderRecord["open_quantity"] ?? orderRecord["openQuantity"],
      ),
      canceledQuantity: numberOrNull(
        orderRecord["canceled_quantity"] ?? orderRecord["canceledQuantity"],
      ),
      filledQuantity: numberOrNull(
        orderRecord["filled_quantity"] ?? orderRecord["filledQuantity"],
      ),
      executionPrice: numberOrNull(
        orderRecord["execution_price"] ?? orderRecord["executionPrice"],
      ),
      limitPrice: numberOrNull(
        orderRecord["limit_price"] ?? orderRecord["limitPrice"],
      ),
      stopPrice: numberOrNull(orderRecord["stop_price"] ?? orderRecord["stopPrice"]),
      orderType: readString(orderRecord, ["order_type", "orderType"]),
      timeInForce: readString(orderRecord, ["time_in_force", "timeInForce"]),
      timePlaced: readString(orderRecord, ["time_placed", "timePlaced"]),
      timeUpdated: readString(orderRecord, ["time_updated", "timeUpdated"]),
      timeExecuted: readString(orderRecord, ["time_executed", "timeExecuted"]),
      expiryDate: readString(orderRecord, ["expiry_date", "expiryDate"]),
    };
  });
}

function parseAccountSymbolsPayload(payload: unknown): SnapTradeAccountSymbol[] {
  const record = asRecord(payload);
  const symbols = Array.isArray(payload)
    ? payload
    : Array.isArray(record["symbols"])
      ? record["symbols"]
      : Array.isArray(record["results"])
        ? record["results"]
        : null;
  if (!symbols) {
    throw new HttpError(502, "SnapTrade symbol search returned invalid data", {
      code: "snaptrade_symbol_search_invalid_response",
      expose: false,
    });
  }

  return symbols.flatMap((symbol) => {
    const symbolRecord = asRecord(symbol);
    const id = readString(symbolRecord, ["id"]);
    const tradingSymbol = readString(symbolRecord, ["symbol"]);
    if (!id || !tradingSymbol) {
      return [];
    }

    const currency = asRecord(symbolRecord["currency"]);
    const exchange = asRecord(symbolRecord["exchange"]);
    const securityType = asRecord(
      symbolRecord["type"] ??
        symbolRecord["security_type"] ??
        symbolRecord["securityType"],
    );

    return [
      {
        id,
        symbol: tradingSymbol,
        rawSymbol: readString(symbolRecord, ["raw_symbol", "rawSymbol"]),
        description: readString(symbolRecord, ["description"]),
        currencyCode:
          readString(currency, ["code"]) ??
          readString(symbolRecord, ["currency_code", "currencyCode"]),
        exchangeCode:
          readString(exchange, ["code"]) ??
          readString(symbolRecord, ["exchange_code", "exchangeCode"]),
        exchangeMicCode:
          readString(exchange, ["mic_code", "micCode"]) ??
          readString(symbolRecord, ["exchange_mic_code", "exchangeMicCode"]),
        exchangeName:
          readString(exchange, ["name"]) ??
          readString(symbolRecord, ["exchange_name", "exchangeName"]),
        exchangeSuffix:
          readString(exchange, ["suffix"]) ??
          readString(symbolRecord, ["exchange_suffix", "exchangeSuffix"]),
        securityTypeCode:
          readString(securityType, ["code"]) ??
          readString(symbolRecord, [
            "security_type_code",
            "securityTypeCode",
            "type_code",
            "typeCode",
          ]),
        securityTypeDescription:
          readString(securityType, ["description"]) ??
          readString(symbolRecord, [
            "security_type_description",
            "securityTypeDescription",
            "type_description",
            "typeDescription",
          ]),
      },
    ];
  });
}

function selectBestAccountSymbol(
  symbols: SnapTradeAccountSymbol[],
  query: string,
): SnapTradeAccountSymbol | null {
  const normalizedQuery = query.trim().toUpperCase();
  return (
    symbols.find((symbol) => symbol.symbol.toUpperCase() === normalizedQuery) ??
    symbols.find(
      (symbol) => symbol.rawSymbol?.toUpperCase() === normalizedQuery,
    ) ??
    symbols[0] ??
    null
  );
}

function assertSubmitRateLimit(accountKey: string, now: Date): void {
  const previous = lastSubmitAtByAccountKey.get(accountKey);
  if (
    previous !== undefined &&
    now.getTime() - previous < SNAPTRADE_MIN_ORDER_INTERVAL_MS
  ) {
    throw new HttpError(429, "SnapTrade order submission is rate limited", {
      code: "snaptrade_order_rate_limited",
    });
  }
  lastSubmitAtByAccountKey.set(accountKey, now.getTime());
}

async function loadOrderContext(input: {
  appUserId: string;
  accountId: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  encryptionKey?: string;
}) {
  const credential = await loadSnapTradeUserCredential({
    appUserId: input.appUserId,
    encryptionKey: input.encryptionKey,
  });
  if (!credential) {
    throw new HttpError(409, "SnapTrade user is not registered", {
      code: "snaptrade_user_not_registered",
    });
  }

  return {
    credential,
    account: await loadLocalSnapTradeAccount(input.appUserId, input.accountId),
    credentials: configuredSnapTradeCredentials(input.env),
  };
}

export async function checkSnapTradeEquityOrderImpact(
  options: CheckSnapTradeEquityOrderImpactOptions,
): Promise<SnapTradeEquityOrderImpactResponse> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const normalizedInput = normalizeImpactInput(options.input);
  const { credential, account, credentials } = await loadOrderContext({
    appUserId: options.appUserId,
    accountId: options.accountId,
    env,
    encryptionKey: options.encryptionKey,
  });
  assertExecutionReady(account);

  const query = buildUserScopedQuery({
    clientId: credentials.clientId,
    timestamp: Math.floor(now.getTime() / 1000).toString(),
    snapTradeUserId: credential.snapTradeUserId,
    userSecret: credential.userSecret,
  });
  const payload = await postSnapTradeJson({
    path: SNAPTRADE_ORDER_IMPACT_PATH,
    query,
    content: impactContent(account, normalizedInput),
    consumerKey: credentials.consumerKey,
    fetchImpl,
    message: "SnapTrade order impact failed",
    networkCode: "snaptrade_order_impact_network_error",
    failedCode: "snaptrade_order_impact_failed",
  });
  const parsed = parseImpactResponse(payload, normalizedInput, now);

  return {
    provider: "snaptrade",
    checkedAt: now.toISOString(),
    account: publicAccount(account),
    ...parsed,
  };
}

export async function submitSnapTradeEquityOrder(
  options: SubmitSnapTradeEquityOrderOptions,
): Promise<SnapTradeEquityOrderSubmitResponse> {
  if (options.input.confirm !== true) {
    throw new HttpError(409, "SnapTrade order submission requires confirmation", {
      code: "snaptrade_order_confirmation_required",
    });
  }

  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const normalizedInput = normalizeSubmitInput(options.input);
  const { credential, account, credentials } = await loadOrderContext({
    appUserId: options.appUserId,
    accountId: options.accountId,
    env,
    encryptionKey: options.encryptionKey,
  });
  assertExecutionReady(account);
  const taxPreflight = await assertTaxPreflightForOrderSubmission({
    appUserId: options.appUserId,
    order: snapTradeSubmitToTaxOrder({
      accountId: options.accountId,
      order: normalizedInput,
    }),
    taxPreflightToken: options.input.taxPreflightToken,
    taxAcknowledgements: options.input.taxAcknowledgements,
    now,
  });
  assertSubmitRateLimit(`${options.appUserId}:${account.id}`, now);

  const query = buildUserScopedQuery({
    clientId: credentials.clientId,
    timestamp: Math.floor(now.getTime() / 1000).toString(),
    snapTradeUserId: credential.snapTradeUserId,
    userSecret: credential.userSecret,
  });
  const payload = await postSnapTradeJson({
    path: SNAPTRADE_PLACE_EQUITY_ORDER_PATH,
    query,
    content: submitContent(account, normalizedInput),
    consumerKey: credentials.consumerKey,
    fetchImpl,
    message: "SnapTrade equity order submission failed",
    networkCode: "snaptrade_order_submit_network_error",
    failedCode: "snaptrade_order_submit_failed",
  });
  const parsed = parseSubmitResponse(payload, normalizedInput);
  await recordTaxPreflightOrderSubmitted({
    appUserId: options.appUserId,
    preflightToken: taxPreflight?.preflightToken,
    submittedOrderId: parsed.order.brokerageOrderId,
  });

  return {
    provider: "snaptrade",
    submittedAt: now.toISOString(),
    account: publicAccount(account),
    ...parsed,
  };
}

export async function listSnapTradeRecentOrders(
  options: ListSnapTradeRecentOrdersOptions,
): Promise<SnapTradeRecentOrdersResponse> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const { credential, account, credentials } = await loadOrderContext({
    appUserId: options.appUserId,
    accountId: options.accountId,
    env,
    encryptionKey: options.encryptionKey,
  });
  assertExecutionReady(account);

  const encodedAccountId = encodeURIComponent(account.snapTradeAccountId);
  const query = buildUserScopedQuery({
    clientId: credentials.clientId,
    timestamp: Math.floor(now.getTime() / 1000).toString(),
    snapTradeUserId: credential.snapTradeUserId,
    userSecret: credential.userSecret,
    extra: options.includeNonExecuted ? { only_executed: false } : undefined,
  });
  const payload = await getSnapTradeJson({
    path: `/accounts/${encodedAccountId}/recentOrders`,
    query,
    consumerKey: credentials.consumerKey,
    fetchImpl,
    message: "SnapTrade recent orders read failed",
    networkCode: "snaptrade_recent_orders_network_error",
    failedCode: "snaptrade_recent_orders_failed",
  });

  return {
    provider: "snaptrade",
    checkedAt: now.toISOString(),
    account: publicAccount(account),
    orders: parseRecentOrdersPayload(payload),
  };
}

export async function searchSnapTradeAccountSymbols(
  options: SearchSnapTradeAccountSymbolsOptions,
): Promise<SnapTradeAccountSymbolSearchResponse> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const queryText = requireSymbolSearchQuery(options.query);
  const { credential, account, credentials } = await loadOrderContext({
    appUserId: options.appUserId,
    accountId: options.accountId,
    env,
    encryptionKey: options.encryptionKey,
  });
  assertExecutionReady(account);

  const encodedAccountId = encodeURIComponent(account.snapTradeAccountId);
  const query = buildUserScopedQuery({
    clientId: credentials.clientId,
    timestamp: Math.floor(now.getTime() / 1000).toString(),
    snapTradeUserId: credential.snapTradeUserId,
    userSecret: credential.userSecret,
  });
  const payload = await postSnapTradeJson({
    path: `/accounts/${encodedAccountId}/symbols`,
    query,
    content: { substring: queryText },
    consumerKey: credentials.consumerKey,
    fetchImpl,
    message: "SnapTrade symbol search failed",
    networkCode: "snaptrade_symbol_search_network_error",
    failedCode: "snaptrade_symbol_search_failed",
  });
  const symbols = parseAccountSymbolsPayload(payload);

  return {
    provider: "snaptrade",
    checkedAt: now.toISOString(),
    query: queryText,
    account: publicAccount(account),
    symbols,
    bestMatch: selectBestAccountSymbol(symbols, queryText),
  };
}
