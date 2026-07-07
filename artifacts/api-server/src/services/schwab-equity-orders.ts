import { and, eq } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import {
  SchwabTraderApiClient,
  type SchwabOrderRequest,
} from "../providers/schwab/trader-api-client";
import { getSchwabAccessToken } from "./schwab-oauth";
import {
  assertTaxPreflightForOrderSubmission,
  recordTaxPreflightOrderSubmitted,
} from "./tax-planning";
import type { TaxOrderLike } from "./tax-planning-model";

// Schwab equity order service — attended-broker order path (Phase 0). Mirrors
// snaptrade-equity-orders. Every operation goes through assertExecutionReady,
// which throws 409 while any executionBlocker (e.g. schwab.order_tooling_unverified)
// is present — so the order path exists and is typed/tested but stays REFUSED at
// runtime until the gates are flipped fact-driven (Phase 2), after a live
// authorized fixture is captured. See docs/plans/schwab-make-tradable-audit.md.

const LOCAL_ID_PREFIX = "schwab:"; // matches schwab-account-sync providerAccountId

export type SchwabEquityOrderAction = "BUY" | "SELL" | "BUY_TO_COVER" | "SELL_SHORT";
export type SchwabEquityOrderType = "Market" | "Limit" | "Stop" | "StopLimit";
export type SchwabEquityTimeInForce = "Day" | "GoodTillCancel" | "FillOrKill";
export type SchwabEquityTradingSession = "Normal" | "Am" | "Pm" | "Seamless";

export type SchwabEquityOrderPreviewInput = {
  symbol: string;
  action: SchwabEquityOrderAction;
  quantity: number;
  orderType: SchwabEquityOrderType;
  timeInForce: SchwabEquityTimeInForce;
  session?: SchwabEquityTradingSession | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
};

export type SchwabEquityOrderSubmitInput = SchwabEquityOrderPreviewInput & {
  // Per-order confirmation gate (ADR-002: terminal orders require confirmation).
  confirm?: boolean;
  taxPreflightToken?: string | null;
  taxAcknowledgements?: string[] | null;
};

export type SchwabEquityOrderAccount = {
  id: string;
  connectionId: string;
  accountHash: string;
  displayName: string;
  baseCurrency: string;
  mode: "live";
  accountStatus: string | null;
  executionReady: boolean;
  executionBlockers: string[];
  lastSyncedAt: string | null;
};

export type SchwabEquityOrderSubmitResponse = {
  provider: "schwab";
  submittedAt: string;
  account: SchwabEquityOrderAccount;
  orderId: string | null;
  status: "submitted";
};

export type SchwabEquityOrderPreviewResponse = {
  provider: "schwab";
  checkedAt: string;
  account: SchwabEquityOrderAccount;
  preview: unknown;
};

type NormalizedSchwabOrder = {
  symbol: string;
  action: SchwabEquityOrderAction;
  quantity: number;
  orderType: SchwabEquityOrderType;
  timeInForce: SchwabEquityTimeInForce;
  session: SchwabEquityTradingSession;
  limitPrice: number | null;
  stopPrice: number | null;
};

type LocalSchwabAccount = SchwabEquityOrderAccount & { capabilities: string[] };

const ACTIONS = new Set<string>(["BUY", "SELL", "BUY_TO_COVER", "SELL_SHORT"]);
const ORDER_TYPES = new Set<string>(["Market", "Limit", "Stop", "StopLimit"]);
const TIME_IN_FORCE = new Set<string>(["Day", "GoodTillCancel", "FillOrKill"]);
const SESSIONS = new Set<string>(["Normal", "Am", "Pm", "Seamless"]);
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.]*$/;

const ORDER_TYPE_WIRE: Record<SchwabEquityOrderType, SchwabOrderRequest["orderType"]> = {
  Market: "MARKET",
  Limit: "LIMIT",
  Stop: "STOP",
  StopLimit: "STOP_LIMIT",
};
const DURATION_WIRE: Record<SchwabEquityTimeInForce, SchwabOrderRequest["duration"]> = {
  Day: "DAY",
  GoodTillCancel: "GOOD_TILL_CANCEL",
  FillOrKill: "FILL_OR_KILL",
};
const SESSION_WIRE: Record<SchwabEquityTradingSession, SchwabOrderRequest["session"]> = {
  Normal: "NORMAL",
  Am: "AM",
  Pm: "PM",
  Seamless: "SEAMLESS",
};
const TAX_ORDER_TYPE_BY_SCHWAB: Record<SchwabEquityOrderType, string> = {
  Market: "market",
  Limit: "limit",
  Stop: "stop",
  StopLimit: "stop_limit",
};
const TAX_TIF_BY_SCHWAB: Record<SchwabEquityTimeInForce, string> = {
  Day: "day",
  GoodTillCancel: "gtc",
  FillOrKill: "fok",
};

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

function normalizeSchwabSymbol(value: string | null | undefined): string | null {
  const symbol = value?.trim().toUpperCase();
  if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
    return null;
  }
  return symbol;
}

function requireSchwabSymbol(value: string | null | undefined): string {
  const symbol = normalizeSchwabSymbol(value);
  if (!symbol) {
    throw new HttpError(422, "Schwab order symbol is invalid", {
      code: "schwab_order_symbol_invalid",
    });
  }
  return symbol;
}

function requirePositiveInteger(value: number, code: string, message: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(422, message, { code });
  }
  return value;
}

function requirePositivePrice(value: number | null | undefined, code: string, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(422, message, { code });
  }
  return value;
}

// Schwab wants price as a string; format up to 4 dp, trimming trailing zeros.
function formatPrice(value: number): string {
  return value.toFixed(4).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function validateSchwabEquityOrderInput(
  input: SchwabEquityOrderPreviewInput,
): NormalizedSchwabOrder {
  const symbol = requireSchwabSymbol(input.symbol);
  const action = assertEnum<SchwabEquityOrderAction>(
    input.action,
    ACTIONS,
    "schwab_order_action_invalid",
    "Schwab order action is invalid",
  );
  const orderType = assertEnum<SchwabEquityOrderType>(
    input.orderType,
    ORDER_TYPES,
    "schwab_order_type_invalid",
    "Schwab order type is invalid",
  );
  const timeInForce = assertEnum<SchwabEquityTimeInForce>(
    input.timeInForce,
    TIME_IN_FORCE,
    "schwab_order_time_in_force_invalid",
    "Schwab order time-in-force is invalid",
  );
  const session = assertEnum<SchwabEquityTradingSession>(
    input.session ?? "Normal",
    SESSIONS,
    "schwab_order_session_invalid",
    "Schwab order session is invalid",
  );
  const quantity = requirePositiveInteger(
    input.quantity,
    "schwab_order_quantity_invalid",
    "Schwab order quantity must be a positive whole number of shares",
  );

  const needsLimit = orderType === "Limit" || orderType === "StopLimit";
  const needsStop = orderType === "Stop" || orderType === "StopLimit";
  const limitPrice = needsLimit
    ? requirePositivePrice(
        input.limitPrice,
        "schwab_order_limit_price_required",
        "Schwab limit orders require a positive limit price",
      )
    : null;
  const stopPrice = needsStop
    ? requirePositivePrice(
        input.stopPrice,
        "schwab_order_stop_price_required",
        "Schwab stop orders require a positive stop price",
      )
    : null;

  return { symbol, action, quantity, orderType, timeInForce, session, limitPrice, stopPrice };
}

export function buildSchwabOrderRequest(order: NormalizedSchwabOrder): SchwabOrderRequest {
  const request: SchwabOrderRequest = {
    orderType: ORDER_TYPE_WIRE[order.orderType],
    session: SESSION_WIRE[order.session],
    duration: DURATION_WIRE[order.timeInForce],
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      {
        instruction: order.action,
        quantity: order.quantity,
        instrument: { symbol: order.symbol, assetType: "EQUITY" },
      },
    ],
  };
  if (order.limitPrice != null) {
    request.price = formatPrice(order.limitPrice);
  }
  if (order.stopPrice != null) {
    request.stopPrice = formatPrice(order.stopPrice);
  }
  return request;
}

function schwabSubmitToTaxOrder(input: {
  accountId: string;
  order: NormalizedSchwabOrder;
}): TaxOrderLike {
  return {
    accountId: input.accountId,
    mode: "live",
    symbol: input.order.symbol,
    assetClass: "equity",
    side:
      input.order.action === "SELL" || input.order.action === "SELL_SHORT"
        ? "sell"
        : "buy",
    type: TAX_ORDER_TYPE_BY_SCHWAB[input.order.orderType],
    quantity: input.order.quantity,
    limitPrice: input.order.limitPrice,
    stopPrice: input.order.stopPrice,
    timeInForce: TAX_TIF_BY_SCHWAB[input.order.timeInForce],
    optionContract: null,
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

export function assertExecutionReady(account: SchwabEquityOrderAccount): void {
  if (account.executionReady) {
    return;
  }
  const blockers = account.executionBlockers.length
    ? account.executionBlockers
    : ["execution_ready_capability_missing"];
  throw new HttpError(409, "Schwab account is not execution-ready", {
    code: "schwab_account_execution_blocked",
    data: { blockers },
  });
}

function publicAccount(account: LocalSchwabAccount): SchwabEquityOrderAccount {
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
    row && row.providerAccountId.startsWith(LOCAL_ID_PREFIX)
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
  });
}

export type SubmitSchwabEquityOrderOptions = OrderContextOptions & {
  input: SchwabEquityOrderSubmitInput;
};

export async function submitSchwabEquityOrder(
  options: SubmitSchwabEquityOrderOptions,
): Promise<SchwabEquityOrderSubmitResponse> {
  if (options.input.confirm !== true) {
    throw new HttpError(409, "Schwab order submission requires confirmation", {
      code: "schwab_order_confirmation_required",
    });
  }
  const now = options.now ?? new Date();
  const normalizedInput = validateSchwabEquityOrderInput(options.input);
  const order = buildSchwabOrderRequest(normalizedInput);
  const account = await loadLocalSchwabAccount(options.appUserId, options.accountId);
  assertExecutionReady(account); // stays blocked until Phase 2 (order_tooling_unverified)
  const taxPreflight = await assertTaxPreflightForOrderSubmission({
    appUserId: options.appUserId,
    order: schwabSubmitToTaxOrder({
      accountId: options.accountId,
      order: normalizedInput,
    }),
    taxPreflightToken: options.input.taxPreflightToken,
    taxAcknowledgements: options.input.taxAcknowledgements,
    now,
  });
  const client = await loadOrderClient(account, options);
  const result = await client.placeOrder(account.accountHash, order);
  await recordTaxPreflightOrderSubmitted({
    appUserId: options.appUserId,
    preflightToken: taxPreflight?.preflightToken,
    submittedOrderId: result.orderId,
  });
  return {
    provider: "schwab",
    submittedAt: now.toISOString(),
    account: publicAccount(account),
    orderId: result.orderId,
    status: "submitted",
  };
}

export type PreviewSchwabEquityOrderOptions = OrderContextOptions & {
  input: SchwabEquityOrderPreviewInput;
};

export async function previewSchwabEquityOrder(
  options: PreviewSchwabEquityOrderOptions,
): Promise<SchwabEquityOrderPreviewResponse> {
  const now = options.now ?? new Date();
  const order = buildSchwabOrderRequest(validateSchwabEquityOrderInput(options.input));
  const account = await loadLocalSchwabAccount(options.appUserId, options.accountId);
  assertExecutionReady(account);
  const client = await loadOrderClient(account, options);
  const preview = await client.previewOrder(account.accountHash, order);
  return {
    provider: "schwab",
    checkedAt: now.toISOString(),
    account: publicAccount(account),
    preview,
  };
}

export type CancelSchwabEquityOrderOptions = OrderContextOptions & { orderId: string };

export async function cancelSchwabEquityOrder(
  options: CancelSchwabEquityOrderOptions,
): Promise<{ provider: "schwab"; canceledAt: string; account: SchwabEquityOrderAccount; orderId: string; status: "canceled" }> {
  const now = options.now ?? new Date();
  const account = await loadLocalSchwabAccount(options.appUserId, options.accountId);
  assertExecutionReady(account);
  const client = await loadOrderClient(account, options);
  await client.cancelOrder(account.accountHash, options.orderId);
  return {
    provider: "schwab",
    canceledAt: now.toISOString(),
    account: publicAccount(account),
    orderId: options.orderId,
    status: "canceled",
  };
}

export const __schwabEquityOrderInternalsForTests = {
  validateSchwabEquityOrderInput,
  buildSchwabOrderRequest,
  schwabSubmitToTaxOrder,
  assertExecutionReady,
  executionReady,
  normalizeSchwabSymbol,
  formatPrice,
};
