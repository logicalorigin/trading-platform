import { and, eq } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  SchwabTraderApiClient,
  type SchwabOrderRequest,
  type SchwabUnknownOrderOutcome,
} from "../providers/schwab/trader-api-client";
import {
  assertExecutionReady,
  type SchwabEquityOrderAccount,
} from "./schwab-equity-orders";
import { getSchwabAccessToken } from "./schwab-oauth";
import {
  assertTaxPreflightForOrderSubmission,
  recordTaxPreflightOrderSubmitted,
} from "./tax-planning";
import type { TaxOrderLike } from "./tax-planning-model";
import {
  requireStandardOptionContractIdentity,
} from "./standard-option-contract-identity";

const LOCAL_ID_PREFIX = "schwab:";
const SCHWAB_OPTION_MIN_ORDER_INTERVAL_MS = 1_000;

export type SchwabOptionInstruction =
  | "BuyToOpen"
  | "SellToClose"
  | "SellToOpen"
  | "BuyToClose";
export type SchwabOptionOrderType = "Market" | "Limit";
export type SchwabOptionDuration = "Day" | "GoodTillCancel" | "FillOrKill";
export type SchwabOptionTradingSession = "Normal" | "Am" | "Pm" | "Seamless";
export type SchwabOptionType = "Call" | "Put";

export type SchwabOptionOrderPreviewInput = {
  contractSymbol: string;
  multiplier: number;
  sharesPerContract: number;
  underlyingSymbol: string;
  expiration: string;
  strike: number;
  optionType: SchwabOptionType;
  instruction: SchwabOptionInstruction;
  orderType: SchwabOptionOrderType;
  duration: SchwabOptionDuration;
  session: SchwabOptionTradingSession;
  quantity: number;
  limitPrice?: number | null;
};

export type SchwabOptionOrderSubmitInput = SchwabOptionOrderPreviewInput & {
  confirm?: boolean;
  taxPreflightToken?: string | null;
  taxAcknowledgements?: string[] | null;
};

export type SchwabOptionOrderAccount = SchwabEquityOrderAccount;

export type SchwabOptionOrderPreviewResponse = {
  provider: "schwab";
  checkedAt: string;
  account: SchwabOptionOrderAccount;
  preview: unknown;
};

export type SchwabOptionOrderSubmitResponse = {
  provider: "schwab";
  submittedAt: string;
  account: SchwabOptionOrderAccount;
  orderId: string | null;
  status: "submitted";
  reconcileRequired?: true;
  reconciliationReason?: "tax_preflight_order_submit_record_failed";
};

export type SchwabOptionOrderCancelResponse = {
  provider: "schwab";
  canceledAt: string;
  account: SchwabOptionOrderAccount;
  orderId: string;
  status: "canceled";
};

type NormalizedSchwabOptionOrder = {
  underlyingSymbol: string;
  expiration: string;
  strike: number;
  optionType: SchwabOptionType;
  optionSymbol: string;
  multiplier: number;
  sharesPerContract: number;
  instruction: SchwabOptionInstruction;
  orderType: SchwabOptionOrderType;
  duration: SchwabOptionDuration;
  session: SchwabOptionTradingSession;
  quantity: number;
  limitPrice: number | null;
};

type SchwabOptionOrderRequest = Omit<
  SchwabOrderRequest,
  "orderType" | "orderLegCollection"
> & {
  orderType: "MARKET" | "LIMIT";
  orderLegCollection: Array<{
    instruction:
      | "BUY_TO_OPEN"
      | "SELL_TO_CLOSE"
      | "SELL_TO_OPEN"
      | "BUY_TO_CLOSE";
    quantity: number;
    instrument: { symbol: string; assetType: "OPTION" };
  }>;
};

type LocalSchwabAccount = SchwabOptionOrderAccount & { capabilities: string[] };

const INSTRUCTIONS = new Set<string>([
  "BuyToOpen",
  "SellToClose",
  "SellToOpen",
  "BuyToClose",
]);
const ORDER_TYPES = new Set<string>(["Market", "Limit"]);
const DURATIONS = new Set<string>(["Day", "GoodTillCancel", "FillOrKill"]);
const SESSIONS = new Set<string>(["Normal", "Am", "Pm", "Seamless"]);
const OPTION_TYPES = new Set<string>(["Call", "Put"]);
const UNDERLYING_PATTERN = /^[A-Z][A-Z0-9.]{0,5}$/u;

const INSTRUCTION_WIRE: Record<
  SchwabOptionInstruction,
  SchwabOptionOrderRequest["orderLegCollection"][number]["instruction"]
> = {
  BuyToOpen: "BUY_TO_OPEN",
  SellToClose: "SELL_TO_CLOSE",
  SellToOpen: "SELL_TO_OPEN",
  BuyToClose: "BUY_TO_CLOSE",
};
const ORDER_TYPE_WIRE: Record<SchwabOptionOrderType, "MARKET" | "LIMIT"> = {
  Market: "MARKET",
  Limit: "LIMIT",
};
const DURATION_WIRE: Record<SchwabOptionDuration, SchwabOrderRequest["duration"]> = {
  Day: "DAY",
  GoodTillCancel: "GOOD_TILL_CANCEL",
  FillOrKill: "FILL_OR_KILL",
};
const SESSION_WIRE: Record<
  SchwabOptionTradingSession,
  SchwabOrderRequest["session"]
> = {
  Normal: "NORMAL",
  Am: "AM",
  Pm: "PM",
  Seamless: "SEAMLESS",
};
const TAX_DURATION: Record<SchwabOptionDuration, string> = {
  Day: "day",
  GoodTillCancel: "gtc",
  FillOrKill: "fok",
};
const lastSubmitAtByAccountKey = new Map<string, number>();

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

function requireUnderlyingSymbol(value: string | null | undefined): string {
  const symbol = value?.trim().toUpperCase();
  if (!symbol || !UNDERLYING_PATTERN.test(symbol)) {
    throw new HttpError(422, "Schwab option underlying symbol is invalid", {
      code: "schwab_option_order_underlying_invalid",
    });
  }
  return symbol;
}

function requireExpiration(value: string | null | undefined): string {
  const expiration = value?.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(expiration ?? "");
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      year >= 2000 &&
      year <= 2099 &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return expiration!;
    }
  }
  throw new HttpError(422, "Schwab option expiration is invalid", {
    code: "schwab_option_order_expiration_invalid",
  });
}

function requireStrike(value: number): number {
  const scaled = Math.round(value * 1_000);
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    scaled > 99_999_999 ||
    Math.abs(value * 1_000 - scaled) > 1e-7
  ) {
    throw new HttpError(422, "Schwab option strike is invalid", {
      code: "schwab_option_order_strike_invalid",
    });
  }
  return scaled / 1_000;
}

function requirePositiveInteger(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(
      422,
      "Schwab option quantity must be a positive whole number of contracts",
      { code: "schwab_option_order_quantity_invalid" },
    );
  }
  return value;
}

function requirePositivePrice(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(
      422,
      "Schwab option limit orders require a positive limit price",
      { code: "schwab_option_order_limit_price_required" },
    );
  }
  return value;
}

function formatPrice(value: number): string {
  return value.toFixed(4).replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "");
}

function formatOptionSymbol(input: {
  underlyingSymbol: string;
  expiration: string;
  strike: number;
  optionType: SchwabOptionType;
}): string {
  const date = input.expiration.replaceAll("-", "").slice(2);
  const side = input.optionType === "Call" ? "C" : "P";
  const strike = String(Math.round(input.strike * 1_000)).padStart(8, "0");
  return `${input.underlyingSymbol.padEnd(6, " ")}${date}${side}${strike}`;
}

export function buildSchwabOptionSymbol(input: {
  underlyingSymbol: string;
  expiration: string;
  strike: number;
  optionType: SchwabOptionType;
}): string {
  return formatOptionSymbol({
    underlyingSymbol: requireUnderlyingSymbol(input.underlyingSymbol),
    expiration: requireExpiration(input.expiration),
    strike: requireStrike(input.strike),
    optionType: assertEnum<SchwabOptionType>(
      input.optionType,
      OPTION_TYPES,
      "schwab_option_order_option_type_invalid",
      "Schwab option type is invalid",
    ),
  });
}

export const buildSchwabOccOptionSymbol = buildSchwabOptionSymbol;

export function validateSchwabOptionOrderInput(
  input: SchwabOptionOrderPreviewInput,
): NormalizedSchwabOptionOrder {
  const underlyingSymbol = requireUnderlyingSymbol(input.underlyingSymbol);
  const expiration = requireExpiration(input.expiration);
  const strike = requireStrike(input.strike);
  const optionType = assertEnum<SchwabOptionType>(
    input.optionType,
    OPTION_TYPES,
    "schwab_option_order_option_type_invalid",
    "Schwab option type is invalid",
  );
  const instruction = assertEnum<SchwabOptionInstruction>(
    input.instruction,
    INSTRUCTIONS,
    "schwab_option_order_instruction_invalid",
    "Schwab option instruction is invalid",
  );
  const orderType = assertEnum<SchwabOptionOrderType>(
    input.orderType,
    ORDER_TYPES,
    "schwab_option_order_type_invalid",
    "Schwab option order type is invalid",
  );
  const duration = assertEnum<SchwabOptionDuration>(
    input.duration,
    DURATIONS,
    "schwab_option_order_duration_invalid",
    "Schwab option duration is invalid",
  );
  const session = assertEnum<SchwabOptionTradingSession>(
    input.session,
    SESSIONS,
    "schwab_option_order_session_invalid",
    "Schwab option session is invalid",
  );
  const quantity = requirePositiveInteger(input.quantity);
  if (orderType === "Market" && input.limitPrice != null) {
    throw new HttpError(422, "Schwab option market orders do not accept a limit price", {
      code: "schwab_option_order_limit_price_unsupported",
    });
  }
  const limitPrice =
    orderType === "Limit" ? requirePositivePrice(input.limitPrice) : null;
  const contractIdentity = requireStandardOptionContractIdentity({
    contractSymbol: input.contractSymbol,
    multiplier: input.multiplier,
    sharesPerContract: input.sharesPerContract,
    underlyingSymbol,
    expiration,
    strike,
    optionType,
  });
  return {
    underlyingSymbol,
    expiration,
    strike,
    optionType,
    optionSymbol: contractIdentity.occSymbol,
    multiplier: contractIdentity.multiplier,
    sharesPerContract: contractIdentity.sharesPerContract,
    instruction,
    orderType,
    duration,
    session,
    quantity,
    limitPrice,
  };
}

export function buildSchwabOptionOrderRequest(
  order: NormalizedSchwabOptionOrder,
): SchwabOptionOrderRequest {
  const request: SchwabOptionOrderRequest = {
    orderType: ORDER_TYPE_WIRE[order.orderType],
    session: SESSION_WIRE[order.session],
    duration: DURATION_WIRE[order.duration],
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      {
        instruction: INSTRUCTION_WIRE[order.instruction],
        quantity: order.quantity,
        instrument: { symbol: order.optionSymbol, assetType: "OPTION" },
      },
    ],
  };
  if (order.limitPrice != null) {
    request.price = formatPrice(order.limitPrice);
  }
  return request;
}

function schwabOptionSubmitToTaxOrder(input: {
  accountId: string;
  order: NormalizedSchwabOptionOrder;
}): TaxOrderLike {
  const right = input.order.optionType.toLowerCase();
  return {
    accountId: input.accountId,
    mode: "live",
    symbol: input.order.underlyingSymbol,
    assetClass: "option",
    side: input.order.instruction.startsWith("Sell") ? "sell" : "buy",
    type: input.order.orderType.toLowerCase(),
    quantity: input.order.quantity,
    limitPrice: input.order.limitPrice,
    stopPrice: null,
    timeInForce: TAX_DURATION[input.order.duration],
    optionContract: {
      ticker: input.order.optionSymbol,
      underlying: input.order.underlyingSymbol,
      expirationDate: input.order.expiration,
      strike: input.order.strike,
      right,
      multiplier: input.order.multiplier,
      sharesPerContract: input.order.sharesPerContract,
      providerContractId: input.order.optionSymbol,
      brokerContractId: input.order.optionSymbol,
    },
    route: "schwab",
    intent: null,
  };
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

function publicAccount(account: LocalSchwabAccount): SchwabOptionOrderAccount {
  return {
    id: account.id,
    connectionId: account.connectionId,
    accountHash: account.accountHash,
    displayName: account.displayName,
    baseCurrency: account.baseCurrency,
    mode: account.mode,
    accountStatus: account.accountStatus,
    executionReady: account.executionReady,
    executionBlockers: account.executionBlockers,
    lastSyncedAt: account.lastSyncedAt,
  };
}

async function loadLocalSchwabAccount(
  appUserId: string,
  accountId: string,
): Promise<LocalSchwabAccount> {
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
        eq(brokerConnectionsTable.brokerProvider, "schwab"),
        eq(brokerAccountsTable.mode, "live"),
      ),
    )
    .limit(1);

  const accountHash =
    row?.providerAccountId.startsWith(LOCAL_ID_PREFIX)
      ? row.providerAccountId.slice(LOCAL_ID_PREFIX.length)
      : null;
  if (!row || !accountHash) {
    throw new HttpError(404, "Schwab account was not found", {
      code: "schwab_account_not_found",
    });
  }
  const capabilities = [...row.capabilities];
  const executionBlockers = [...row.executionBlockers];
  return {
    id: row.id,
    connectionId: row.connectionId,
    accountHash,
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

type OrderContextOptions = {
  appUserId: string;
  accountId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  keyVersion?: string;
  baseUrl?: string;
  requestTimeoutMs?: number;
};

async function loadOrderClient(
  account: LocalSchwabAccount,
  options: OrderContextOptions,
): Promise<SchwabTraderApiClient> {
  const accessToken = await getSchwabAccessToken({
    appUserId: options.appUserId,
    env: options.env,
    fetchImpl: options.fetchImpl,
    now: options.now,
    encryptionKey: options.encryptionKey,
    keyVersion: options.keyVersion,
  });
  return new SchwabTraderApiClient({
    accessToken,
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    requestTimeoutMs: options.requestTimeoutMs,
  });
}

function clientOrder(order: SchwabOptionOrderRequest): SchwabOrderRequest {
  // ponytail: the shared transport type is equity-only; remove this cast when it accepts option legs.
  return order as unknown as SchwabOrderRequest;
}

function assertSubmitRateLimit(accountKey: string, now: Date): void {
  const previous = lastSubmitAtByAccountKey.get(accountKey);
  if (
    previous !== undefined &&
    now.getTime() - previous < SCHWAB_OPTION_MIN_ORDER_INTERVAL_MS
  ) {
    throw new HttpError(429, "Schwab option order submission is rate limited", {
      code: "schwab_option_order_rate_limited",
    });
  }
  lastSubmitAtByAccountKey.set(accountKey, now.getTime());
}

function reconcileRequiredError(input: {
  now: Date;
  account: LocalSchwabAccount;
  outcome: SchwabUnknownOrderOutcome;
}): HttpError {
  return new HttpError(
    409,
    "Schwab option order submission outcome is unknown; reconcile before retrying",
    {
      code: "schwab_option_order_submit_reconcile_required",
      expose: true,
      data: {
        provider: "schwab",
        submittedAt: input.now.toISOString(),
        account: publicAccount(input.account),
        orderId: null,
        status: "reconcile_required",
        outcome: "unknown",
        reason: input.outcome.reason,
        timeoutMs: input.outcome.timeoutMs,
        reconcileRequired: true,
        retryable: false,
        sourceCode: input.outcome.sourceCode,
      },
    },
  );
}

const SENSITIVE_RESPONSE_KEYS = new Set([
  "authorization",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "appsecret",
  "accountnumber",
  "accountnumbers",
  "hashvalue",
  "credentials",
  "raw",
  "rawpayload",
]);

function sanitizePreview(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizePreview);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => {
        const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
        return (
          !SENSITIVE_RESPONSE_KEYS.has(normalized) &&
          !normalized.endsWith("token")
        );
      })
      .map(([key, entry]) => [key, sanitizePreview(entry)]),
  );
}

export type PreviewSchwabOptionOrderOptions = OrderContextOptions & {
  input: SchwabOptionOrderPreviewInput;
};

export async function previewSchwabOptionOrder(
  options: PreviewSchwabOptionOrderOptions,
): Promise<SchwabOptionOrderPreviewResponse> {
  const now = options.now ?? new Date();
  const order = buildSchwabOptionOrderRequest(
    validateSchwabOptionOrderInput(options.input),
  );
  const account = await loadLocalSchwabAccount(options.appUserId, options.accountId);
  assertExecutionReady(account);
  const client = await loadOrderClient(account, options);
  const preview = await client.previewOrder(
    account.accountHash,
    clientOrder(order),
  );
  return {
    provider: "schwab",
    checkedAt: now.toISOString(),
    account: publicAccount(account),
    preview: sanitizePreview(preview),
  };
}

export type SubmitSchwabOptionOrderOptions = OrderContextOptions & {
  input: SchwabOptionOrderSubmitInput;
};

export async function submitSchwabOptionOrder(
  options: SubmitSchwabOptionOrderOptions,
): Promise<SchwabOptionOrderSubmitResponse> {
  if (options.input.confirm !== true) {
    throw new HttpError(
      409,
      "Schwab option order submission requires confirmation",
      { code: "schwab_option_order_confirmation_required" },
    );
  }
  const now = options.now ?? new Date();
  const normalizedInput = validateSchwabOptionOrderInput(options.input);
  const order = buildSchwabOptionOrderRequest(normalizedInput);
  const account = await loadLocalSchwabAccount(options.appUserId, options.accountId);
  assertExecutionReady(account);
  const taxPreflight = await assertTaxPreflightForOrderSubmission({
    appUserId: options.appUserId,
    order: schwabOptionSubmitToTaxOrder({
      accountId: options.accountId,
      order: normalizedInput,
    }),
    taxPreflightToken: options.input.taxPreflightToken,
    taxAcknowledgements: options.input.taxAcknowledgements,
    now,
  });
  assertSubmitRateLimit(`${options.appUserId}:${account.id}`, now);
  const client = await loadOrderClient(account, options);
  const result = await client.placeOrder(account.accountHash, clientOrder(order));
  if ("status" in result && result.status === "unknown") {
    throw reconcileRequiredError({ now, account, outcome: result });
  }
  try {
    await recordTaxPreflightOrderSubmitted({
      appUserId: options.appUserId,
      preflightToken: taxPreflight?.preflightToken,
      submittedOrderId: result.orderId,
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        appUserId: options.appUserId,
        accountId: options.accountId,
        schwabAccountId: account.id,
        orderId: result.orderId,
      },
      "Schwab option order placed but tax preflight submit record failed; reconciliation required",
    );
    return {
      provider: "schwab",
      submittedAt: now.toISOString(),
      account: publicAccount(account),
      orderId: result.orderId,
      status: "submitted",
      reconcileRequired: true,
      reconciliationReason: "tax_preflight_order_submit_record_failed",
    };
  }
  return {
    provider: "schwab",
    submittedAt: now.toISOString(),
    account: publicAccount(account),
    orderId: result.orderId,
    status: "submitted",
  };
}

export type CancelSchwabOptionOrderOptions = OrderContextOptions & {
  orderId: string;
};

export async function cancelSchwabOptionOrder(
  options: CancelSchwabOptionOrderOptions,
): Promise<SchwabOptionOrderCancelResponse> {
  const orderId = options.orderId.trim();
  if (!orderId) {
    throw new HttpError(422, "Schwab option order id is invalid", {
      code: "schwab_option_order_id_invalid",
    });
  }
  const now = options.now ?? new Date();
  const account = await loadLocalSchwabAccount(options.appUserId, options.accountId);
  assertExecutionReady(account);
  const client = await loadOrderClient(account, options);
  await client.cancelOrder(account.accountHash, orderId);
  return {
    provider: "schwab",
    canceledAt: now.toISOString(),
    account: publicAccount(account),
    orderId,
    status: "canceled",
  };
}

export const __schwabOptionOrderInternalsForTests = {
  validateSchwabOptionOrderInput,
  buildSchwabOptionOrderRequest,
  schwabOptionSubmitToTaxOrder,
  sanitizePreview,
  formatPrice,
  resetSubmitRateLimit: () => lastSubmitAtByAccountKey.clear(),
};
