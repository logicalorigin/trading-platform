import { and, eq } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import {
  SchwabTraderApiClient,
  type SchwabOrdersQuery,
} from "../providers/schwab/trader-api-client";
import {
  assertExecutionReady,
  type SchwabEquityOrderAccount,
} from "./schwab-equity-orders";
import { getSchwabAccessToken } from "./schwab-oauth";

// Schwab recent-orders read (equity + options — Schwab returns both asset classes
// from the same /orders endpoint). Mirrors schwab-equity-orders' loadLocalSchwabAccount
// + assertExecutionReady gate; returns sanitized normalized rows only (never the raw
// account number or any leg-level identifiers Schwab echoes back).

const LOCAL_ID_PREFIX = "schwab:"; // matches schwab-account-sync providerAccountId

type LocalSchwabAccount = SchwabEquityOrderAccount & { capabilities: string[] };

export type SchwabRecentOrder = {
  orderId: string | null;
  symbol: string | null;
  assetType: string | null;
  instruction: string | null;
  quantity: number | null;
  filledQuantity: number | null;
  status: string;
  orderType: string | null;
  price: number | null;
  enteredTime: string | null;
};

export type SchwabRecentOrdersResponse = {
  provider: "schwab";
  checkedAt: string;
  account: SchwabEquityOrderAccount;
  orders: SchwabRecentOrder[];
};

export type ListSchwabRecentOrdersOptions = {
  appUserId: string;
  accountId: string;
  query?: SchwabOrdersQuery;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  keyVersion?: string;
  baseUrl?: string;
  requestTimeoutMs?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringIdentifier(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
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

async function loadOrderClient(
  options: ListSchwabRecentOrdersOptions,
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

// Whitelist the fields we surface; Schwab order objects also carry accountNumber
// and leg-level ids we deliberately drop.
function normalizeSchwabOrder(raw: unknown): SchwabRecentOrder {
  const record = asRecord(raw);
  const legs = Array.isArray(record["orderLegCollection"])
    ? record["orderLegCollection"]
    : [];
  const firstLeg = asRecord(legs[0]);
  const instrument = asRecord(firstLeg["instrument"]);
  return {
    orderId: stringIdentifier(record["orderId"]),
    symbol: nonEmptyString(instrument["symbol"]),
    assetType: nonEmptyString(instrument["assetType"]),
    instruction: nonEmptyString(firstLeg["instruction"]),
    quantity: numberOrNull(record["quantity"]),
    filledQuantity: numberOrNull(record["filledQuantity"]),
    status: nonEmptyString(record["status"]) ?? "UNKNOWN",
    orderType: nonEmptyString(record["orderType"]),
    price: numberOrNull(record["price"]),
    enteredTime: nonEmptyString(record["enteredTime"]),
  };
}

export async function listSchwabRecentOrders(
  options: ListSchwabRecentOrdersOptions,
): Promise<SchwabRecentOrdersResponse> {
  const now = options.now ?? new Date();
  const account = await loadLocalSchwabAccount(
    options.appUserId,
    options.accountId,
  );
  assertExecutionReady(account);
  const client = await loadOrderClient(options);
  const rawOrders = await client.getOrders(
    account.accountHash,
    options.query ?? {},
  );
  return {
    provider: "schwab",
    checkedAt: now.toISOString(),
    account: publicAccount(account),
    orders: rawOrders.map(normalizeSchwabOrder),
  };
}
