import { and, eq } from "drizzle-orm";

import { brokerAccountsTable, brokerConnectionsTable, db } from "@workspace/db";
import { readEnvString } from "../lib/env";
import { HttpError } from "../lib/errors";
import {
  listSnapTradeRecentOrders,
  type ListSnapTradeRecentOrdersOptions,
  type SnapTradeEquityOrderAccount,
  type SnapTradeRecentOrdersResponse,
} from "./snaptrade-equity-orders";
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

export const SNAPTRADE_OPTION_ORDER_ACTIONS = [
  "BUY_TO_OPEN",
  "SELL_TO_CLOSE",
  "SELL_TO_OPEN",
  "BUY_TO_CLOSE",
] as const;
export const SNAPTRADE_OPTION_ORDER_TYPES = ["Market", "Limit"] as const;
export const SNAPTRADE_OPTION_TIME_IN_FORCE_VALUES = [
  "Day",
  "GTC",
  "FOK",
  "IOC",
] as const;
export const SNAPTRADE_OPTION_TYPES = ["Call", "Put"] as const;

export type SnapTradeOptionOrderAction =
  (typeof SNAPTRADE_OPTION_ORDER_ACTIONS)[number];
export type SnapTradeOptionOrderType =
  (typeof SNAPTRADE_OPTION_ORDER_TYPES)[number];
export type SnapTradeOptionTimeInForce =
  (typeof SNAPTRADE_OPTION_TIME_IN_FORCE_VALUES)[number];
export type SnapTradeOptionType = (typeof SNAPTRADE_OPTION_TYPES)[number];

export type SnapTradeOptionOrderInput = {
  underlyingSymbol: string;
  expiration: string;
  strike: number;
  optionType: SnapTradeOptionType;
  action: SnapTradeOptionOrderAction;
  orderType: SnapTradeOptionOrderType;
  timeInForce: SnapTradeOptionTimeInForce;
  units: number;
  price?: number | null;
};

export type SnapTradeOptionOrderSubmitInput = SnapTradeOptionOrderInput & {
  confirm?: boolean;
  taxPreflightToken?: string | null;
  taxAcknowledgements?: string[] | null;
};

export type SnapTradeOptionOrderDetails = {
  underlyingSymbol: string;
  occSymbol: string;
  expiration: string;
  strike: number;
  optionType: SnapTradeOptionType;
  action: SnapTradeOptionOrderAction;
  orderType: SnapTradeOptionOrderType;
  timeInForce: SnapTradeOptionTimeInForce;
  units: number;
  price: number | null;
};

export type SnapTradeOptionOrderImpactResponse = {
  provider: "snaptrade";
  checkedAt: string;
  account: SnapTradeEquityOrderAccount;
  order: SnapTradeOptionOrderDetails;
  impact: {
    estimatedCashChange: number | null;
    cashChangeDirection: string | null;
    estimatedFeeTotal: number | null;
  };
};

export type SnapTradeOptionOrderSubmitResponse = {
  provider: "snaptrade";
  submittedAt: string;
  account: SnapTradeEquityOrderAccount;
  order: SnapTradeOptionOrderDetails & {
    brokerageOrderId: string;
    status: string;
  };
};

export type CheckSnapTradeOptionOrderImpactOptions = {
  appUserId: string;
  accountId: string;
  input: SnapTradeOptionOrderInput;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
};

export type SubmitSnapTradeOptionOrderOptions = {
  appUserId: string;
  accountId: string;
  input: SnapTradeOptionOrderSubmitInput;
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

type NormalizedOptionOrderInput = SnapTradeOptionOrderDetails;

const LOCAL_ID_PREFIX = "snaptrade:";
const SNAPTRADE_MIN_ORDER_INTERVAL_MS = 1000;
const OCC_UNDERLYING_PATTERN = /^[A-Z0-9]{1,6}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ACTIONS = new Set<string>(SNAPTRADE_OPTION_ORDER_ACTIONS);
const ORDER_TYPES = new Set<string>(SNAPTRADE_OPTION_ORDER_TYPES);
const TIME_IN_FORCE_VALUES = new Set<string>(
  SNAPTRADE_OPTION_TIME_IN_FORCE_VALUES,
);
const OPTION_TYPES = new Set<string>(SNAPTRADE_OPTION_TYPES);
const lastSubmitAtByAccountKey = new Map<string, number>();

const SNAPTRADE_ORDER_TYPE: Record<SnapTradeOptionOrderType, string> = {
  Market: "MARKET",
  Limit: "LIMIT",
};
const TAX_ORDER_TYPE: Record<SnapTradeOptionOrderType, TaxOrderLike["type"]> = {
  Market: "market",
  Limit: "limit",
};
const TAX_TIME_IN_FORCE: Record<
  SnapTradeOptionTimeInForce,
  TaxOrderLike["timeInForce"]
> = {
  Day: "day",
  GTC: "gtc",
  FOK: "fok",
  IOC: "ioc",
};

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

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
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
}): string {
  const query = new URLSearchParams();
  query.set("clientId", input.clientId);
  query.set("timestamp", input.timestamp);
  query.set("userId", input.snapTradeUserId);
  query.set("userSecret", input.userSecret);
  return query.toString();
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

function publicAccount(
  account: LocalSnapTradeAccount,
): SnapTradeEquityOrderAccount {
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
  if (account.executionReady) return;
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
  value: unknown,
  allowed: Set<string>,
  code: string,
  message: string,
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new HttpError(422, message, { code });
  }
  return value as T;
}

function normalizeUnderlyingSymbol(value: unknown): string {
  const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!OCC_UNDERLYING_PATTERN.test(symbol)) {
    throw new HttpError(422, "SnapTrade option underlying symbol is invalid", {
      code: "snaptrade_option_underlying_symbol_invalid",
    });
  }
  return symbol;
}

function normalizeExpiration(value: unknown): string {
  const expiration = typeof value === "string" ? value.trim() : "";
  const parsed = new Date(`${expiration}T00:00:00.000Z`);
  if (
    !ISO_DATE_PATTERN.test(expiration) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== expiration
  ) {
    throw new HttpError(422, "SnapTrade option expiration is invalid", {
      code: "snaptrade_option_expiration_invalid",
    });
  }
  return expiration;
}

function normalizeStrike(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(422, "SnapTrade option strike is invalid", {
      code: "snaptrade_option_strike_invalid",
    });
  }
  const scaled = Math.round(value * 1000);
  if (scaled > 99_999_999 || Math.abs(scaled / 1000 - value) > 1e-9) {
    throw new HttpError(422, "SnapTrade option strike is invalid", {
      code: "snaptrade_option_strike_invalid",
    });
  }
  return scaled / 1000;
}

export function buildOccSymbol(input: {
  underlyingSymbol: string;
  expiration: string;
  strike: number;
  optionType: SnapTradeOptionType;
}): string {
  const underlyingSymbol = normalizeUnderlyingSymbol(input.underlyingSymbol);
  const expiration = normalizeExpiration(input.expiration);
  const strike = normalizeStrike(input.strike);
  const optionType = assertEnum<SnapTradeOptionType>(
    input.optionType,
    OPTION_TYPES,
    "snaptrade_option_type_invalid",
    "SnapTrade option type is invalid",
  );
  return `${underlyingSymbol.padEnd(6, " ")}${expiration.slice(2).replaceAll("-", "")}${
    optionType === "Call" ? "C" : "P"
  }${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

function normalizeInput(
  input: SnapTradeOptionOrderInput,
): NormalizedOptionOrderInput {
  const underlyingSymbol = normalizeUnderlyingSymbol(input.underlyingSymbol);
  const expiration = normalizeExpiration(input.expiration);
  const strike = normalizeStrike(input.strike);
  const optionType = assertEnum<SnapTradeOptionType>(
    input.optionType,
    OPTION_TYPES,
    "snaptrade_option_type_invalid",
    "SnapTrade option type is invalid",
  );
  const action = assertEnum<SnapTradeOptionOrderAction>(
    input.action,
    ACTIONS,
    "snaptrade_option_order_action_invalid",
    "SnapTrade option order action is invalid",
  );
  const orderType = assertEnum<SnapTradeOptionOrderType>(
    input.orderType,
    ORDER_TYPES,
    "snaptrade_option_order_type_invalid",
    "SnapTrade option order type is invalid",
  );
  const timeInForce = assertEnum<SnapTradeOptionTimeInForce>(
    input.timeInForce,
    TIME_IN_FORCE_VALUES,
    "snaptrade_option_order_time_in_force_invalid",
    "SnapTrade option order time in force is invalid",
  );
  if (!Number.isInteger(input.units) || input.units <= 0) {
    throw new HttpError(
      422,
      "SnapTrade option order units must be positive contracts",
      {
        code: "snaptrade_option_order_units_invalid",
      },
    );
  }
  const price = input.price == null ? null : input.price;
  if (price != null && (!Number.isFinite(price) || price <= 0)) {
    throw new HttpError(422, "SnapTrade option order price must be positive", {
      code: "snaptrade_option_order_price_invalid",
    });
  }
  if (orderType === "Limit" && price == null) {
    throw new HttpError(422, "SnapTrade option limit orders require a price", {
      code: "snaptrade_option_order_price_required",
    });
  }

  return {
    underlyingSymbol,
    expiration,
    strike,
    optionType,
    action,
    orderType,
    timeInForce,
    units: input.units,
    price,
    occSymbol: buildOccSymbol({
      underlyingSymbol,
      expiration,
      strike,
      optionType,
    }),
  };
}

function priceEffect(action: SnapTradeOptionOrderAction): "CREDIT" | "DEBIT" {
  return action.startsWith("BUY_") ? "DEBIT" : "CREDIT";
}

function orderContent(
  input: NormalizedOptionOrderInput,
): Record<string, unknown> {
  return {
    order_type: SNAPTRADE_ORDER_TYPE[input.orderType],
    time_in_force: input.timeInForce,
    ...(input.price == null ? {} : { limit_price: String(input.price) }),
    price_effect: priceEffect(input.action),
    legs: [
      {
        instrument: {
          symbol: input.occSymbol,
          instrument_type: "OPTION",
        },
        action: input.action,
        units: input.units,
      },
    ],
  };
}

function optionTaxOrder(input: {
  accountId: string;
  order: NormalizedOptionOrderInput;
}): TaxOrderLike {
  return {
    accountId: input.accountId,
    mode: "live",
    symbol: input.order.underlyingSymbol,
    assetClass: "option",
    side: input.order.action.startsWith("BUY_") ? "buy" : "sell",
    type: TAX_ORDER_TYPE[input.order.orderType],
    quantity: input.order.units,
    limitPrice: input.order.price,
    stopPrice: null,
    timeInForce: TAX_TIME_IN_FORCE[input.order.timeInForce],
    optionContract: {
      ticker: input.order.occSymbol,
      underlying: input.order.underlyingSymbol,
      expirationDate: input.order.expiration,
      strike: input.order.strike,
      right: input.order.optionType.toLowerCase(),
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: input.order.occSymbol,
      brokerContractId: input.order.occSymbol,
    },
    route: "snaptrade",
    intent: null,
  };
}

function parseImpactResponse(
  payload: unknown,
  order: NormalizedOptionOrderInput,
): Pick<SnapTradeOptionOrderImpactResponse, "order" | "impact"> {
  const record = asRecord(payload);
  if (
    record["estimated_cash_change"] === undefined ||
    record["estimated_fee_total"] === undefined
  ) {
    throw new HttpError(
      502,
      "SnapTrade option order impact returned invalid data",
      {
        code: "snaptrade_option_order_impact_invalid_response",
        expose: false,
      },
    );
  }
  return {
    order,
    impact: {
      estimatedCashChange: numberOrNull(record["estimated_cash_change"]),
      cashChangeDirection: nonEmptyString(record["cash_change_direction"]),
      estimatedFeeTotal: numberOrNull(record["estimated_fee_total"]),
    },
  };
}

function parseSubmitResponse(
  payload: unknown,
  order: NormalizedOptionOrderInput,
): Pick<SnapTradeOptionOrderSubmitResponse, "order"> {
  const record = asRecord(payload);
  const firstOrder = Array.isArray(record["orders"])
    ? asRecord(record["orders"][0])
    : {};
  const brokerageOrderId =
    readString(record, ["brokerage_order_id", "brokerageOrderId"]) ??
    readString(firstOrder, ["brokerage_order_id", "brokerageOrderId"]);
  if (!brokerageOrderId) {
    throw new HttpError(502, "SnapTrade option order returned invalid data", {
      code: "snaptrade_option_order_submit_invalid_response",
      expose: false,
    });
  }
  return {
    order: {
      ...order,
      brokerageOrderId,
      status:
        readString(firstOrder, ["status"]) ??
        readString(record, ["status"]) ??
        "UNKNOWN",
    },
  };
}

function assertSubmitRateLimit(accountKey: string, now: Date): void {
  const previous = lastSubmitAtByAccountKey.get(accountKey);
  if (
    previous !== undefined &&
    now.getTime() - previous < SNAPTRADE_MIN_ORDER_INTERVAL_MS
  ) {
    throw new HttpError(
      429,
      "SnapTrade option order submission is rate limited",
      {
        code: "snaptrade_option_order_rate_limited",
      },
    );
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

export async function checkSnapTradeOptionOrderImpact(
  options: CheckSnapTradeOptionOrderImpactOptions,
): Promise<SnapTradeOptionOrderImpactResponse> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const normalizedInput = normalizeInput(options.input);
  const { credential, account, credentials } = await loadOrderContext({
    appUserId: options.appUserId,
    accountId: options.accountId,
    env,
    encryptionKey: options.encryptionKey,
  });
  assertExecutionReady(account);

  const path = `/accounts/${encodeURIComponent(account.snapTradeAccountId)}/trading/options/impact`;
  const query = buildUserScopedQuery({
    clientId: credentials.clientId,
    timestamp: Math.floor(now.getTime() / 1000).toString(),
    snapTradeUserId: credential.snapTradeUserId,
    userSecret: credential.userSecret,
  });
  const payload = await postSnapTradeJson({
    path,
    query,
    content: orderContent(normalizedInput),
    consumerKey: credentials.consumerKey,
    fetchImpl,
    message: "SnapTrade option order impact failed",
    networkCode: "snaptrade_option_order_impact_network_error",
    failedCode: "snaptrade_option_order_impact_failed",
  });

  return {
    provider: "snaptrade",
    checkedAt: now.toISOString(),
    account: publicAccount(account),
    ...parseImpactResponse(payload, normalizedInput),
  };
}

export async function submitSnapTradeOptionOrder(
  options: SubmitSnapTradeOptionOrderOptions,
): Promise<SnapTradeOptionOrderSubmitResponse> {
  if (options.input.confirm !== true) {
    throw new HttpError(
      409,
      "SnapTrade option order submission requires confirmation",
      { code: "snaptrade_option_order_confirmation_required" },
    );
  }

  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const normalizedInput = normalizeInput(options.input);
  const { credential, account, credentials } = await loadOrderContext({
    appUserId: options.appUserId,
    accountId: options.accountId,
    env,
    encryptionKey: options.encryptionKey,
  });
  assertExecutionReady(account);
  const taxPreflight = await assertTaxPreflightForOrderSubmission({
    appUserId: options.appUserId,
    order: optionTaxOrder({
      accountId: options.accountId,
      order: normalizedInput,
    }),
    taxPreflightToken: options.input.taxPreflightToken,
    taxAcknowledgements: options.input.taxAcknowledgements,
    now,
  });
  assertSubmitRateLimit(`${options.appUserId}:${account.id}`, now);

  const path = `/accounts/${encodeURIComponent(account.snapTradeAccountId)}/trading/options`;
  const query = buildUserScopedQuery({
    clientId: credentials.clientId,
    timestamp: Math.floor(now.getTime() / 1000).toString(),
    snapTradeUserId: credential.snapTradeUserId,
    userSecret: credential.userSecret,
  });
  const payload = await postSnapTradeJson({
    path,
    query,
    content: orderContent(normalizedInput),
    consumerKey: credentials.consumerKey,
    fetchImpl,
    message: "SnapTrade option order submission failed",
    networkCode: "snaptrade_option_order_submit_network_error",
    failedCode: "snaptrade_option_order_submit_failed",
  });
  const parsed = parseSubmitResponse(payload, normalizedInput);
  await recordTaxPreflightOrderSubmitted({
    appUserId: options.appUserId,
    preflightToken: taxPreflight?.preflightToken,
    submittedOrderId: parsed.order.brokerageOrderId,
    provider: "snaptrade",
  });

  return {
    provider: "snaptrade",
    submittedAt: now.toISOString(),
    account: publicAccount(account),
    ...parsed,
  };
}

export async function listSnapTradeRecentOptionOrders(
  options: ListSnapTradeRecentOrdersOptions,
): Promise<SnapTradeRecentOrdersResponse> {
  const result = await listSnapTradeRecentOrders(options);
  return {
    ...result,
    orders: result.orders.filter(
      (order) => order.optionSymbolId != null || order.optionTicker != null,
    ),
  };
}
