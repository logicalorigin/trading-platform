import { and, eq } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { SchwabTraderApiClient } from "../providers/schwab/trader-api-client";
import { getSchwabAccessToken } from "./schwab-oauth";

export type SchwabConnectionSyncConnection = {
  id: string;
  provider: "schwab";
  connectionKind: "trader_api_oauth";
  status: "connected" | "disconnected" | "error";
  executionReady: boolean;
  executionBlockers: string[];
  accountCount: number;
  mode: "live";
};

export type SchwabConnectionSyncAccount = {
  id: string;
  connectionId: string;
  schwabAccountHash: string;
  displayName: string;
  accountType: string | null;
  baseCurrency: string;
  executionReady: boolean;
  executionBlockers: string[];
  mode: "live";
  lastSyncedAt: string;
};

export type SchwabConnectionSyncResponse = {
  provider: "schwab";
  syncedAt: string;
  connections: SchwabConnectionSyncConnection[];
  accounts: SchwabConnectionSyncAccount[];
  totals: {
    upstreamAccounts: number;
    storedConnections: number;
    storedAccounts: number;
  };
};

export type SyncSchwabConnectionsOptions = {
  appUserId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  baseUrl?: string;
};

type NormalizedAccount = {
  hashValue: string;
  accountNumber: string;
  type: string | null;
  closed: boolean;
  displayName: string;
  baseCurrency: string;
};

const LOCAL_ID_PREFIX = "schwab:";
const MAX_PROVIDER_ID_LENGTH = 128 - LOCAL_ID_PREFIX.length;
const CONNECTION_NAME = "schwab:trader-api";

// Order endpoints are unexercised until a live authorized fixture is
// captured, so every account carries this blocker.
const ORDER_TOOLING_UNVERIFIED_BLOCKER = "schwab.order_tooling_unverified";

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

function invalidResponse(): HttpError {
  return new HttpError(502, "Schwab account sync returned invalid data", {
    code: "schwab_account_sync_invalid_response",
    expose: false,
  });
}

function accountLastFour(accountNumber: string): string | null {
  const digits = accountNumber.replace(/\D/gu, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function buildDisplayName(type: string | null, accountNumber: string): string {
  const lastFour = accountLastFour(accountNumber);
  if (!lastFour) {
    return "Schwab account";
  }
  const typePrefix = type ? `${type.charAt(0)}${type.slice(1).toLowerCase()} ` : "";
  return `Schwab ${typePrefix}account ...${lastFour}`;
}

function normalizeAccount(
  value: unknown,
  hashByAccountNumber: Map<string, string>,
): NormalizedAccount | null {
  const record = asRecord(value);
  const securitiesAccount = record["securitiesAccount"];
  const accountRecord =
    securitiesAccount && typeof securitiesAccount === "object" && !Array.isArray(securitiesAccount)
      ? asRecord(securitiesAccount)
      : record;

  const accountNumber = readString(accountRecord, [
    "accountNumber",
    "account_number",
  ]);
  if (!accountNumber) {
    return null;
  }

  const hashValue = hashByAccountNumber.get(accountNumber);
  if (!hashValue) {
    // Accounts with no matching hash cannot be addressed by the API.
    return null;
  }
  if (hashValue.length > MAX_PROVIDER_ID_LENGTH) {
    throw invalidResponse();
  }

  const type = readString(accountRecord, ["type"]);
  const closed =
    readString(accountRecord, ["status", "state"])?.toLowerCase() === "closed";

  return {
    hashValue,
    accountNumber,
    type,
    closed,
    displayName: buildDisplayName(type, accountNumber),
    baseCurrency: "USD",
  };
}

function accountExecutionBlockers(account: NormalizedAccount): string[] {
  const blockers = [ORDER_TOOLING_UNVERIFIED_BLOCKER];
  if (account.closed) {
    blockers.push("schwab.account.closed");
  }
  return blockers;
}

async function upsertConnection(input: {
  appUserId: string;
  syncedAt: Date;
}): Promise<string> {
  const capabilities = ["accounts", "positions", "schwab", "schwab-trader-api"];
  const [existing] = await db
    .select({ id: brokerConnectionsTable.id })
    .from(brokerConnectionsTable)
    .where(
      and(
        eq(brokerConnectionsTable.appUserId, input.appUserId),
        eq(brokerConnectionsTable.connectionType, "broker"),
        eq(brokerConnectionsTable.mode, "live"),
        eq(brokerConnectionsTable.name, CONNECTION_NAME),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(brokerConnectionsTable)
      .set({
        brokerProvider: "schwab",
        status: "connected",
        capabilities,
        updatedAt: input.syncedAt,
      })
      .where(eq(brokerConnectionsTable.id, existing.id))
      .returning({ id: brokerConnectionsTable.id });
    if (updated) {
      return updated.id;
    }
  }

  const [stored] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: input.appUserId,
      name: CONNECTION_NAME,
      connectionType: "broker",
      brokerProvider: "schwab",
      mode: "live",
      status: "connected",
      capabilities,
      isDefault: false,
    })
    .returning({ id: brokerConnectionsTable.id });

  if (!stored) {
    throw new HttpError(500, "Failed to store Schwab broker connection", {
      code: "schwab_connection_store_failed",
      expose: false,
    });
  }
  return stored.id;
}

async function upsertAccount(input: {
  appUserId: string;
  account: NormalizedAccount;
  executionBlockers: string[];
  localConnectionId: string;
  syncedAt: Date;
}): Promise<string> {
  const lastSyncedAt = input.syncedAt.toISOString();
  const providerAccountId = `${LOCAL_ID_PREFIX}${input.account.hashValue}`;
  const capabilities = ["accounts", "positions", "schwab"];
  const [existing] = await db
    .select({ id: brokerAccountsTable.id })
    .from(brokerAccountsTable)
    .where(
      and(
        eq(brokerAccountsTable.appUserId, input.appUserId),
        eq(brokerAccountsTable.providerAccountId, providerAccountId),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(brokerAccountsTable)
      .set({
        connectionId: input.localConnectionId,
        displayName: input.account.displayName,
        mode: "live",
        accountStatus: input.account.closed ? "closed" : null,
        baseCurrency: input.account.baseCurrency,
        capabilities,
        executionBlockers: input.executionBlockers,
        lastSyncedAt,
        updatedAt: input.syncedAt,
      })
      .where(eq(brokerAccountsTable.id, existing.id))
      .returning({ id: brokerAccountsTable.id });
    if (updated) {
      return updated.id;
    }
  }

  const [stored] = await db
    .insert(brokerAccountsTable)
    .values({
      appUserId: input.appUserId,
      connectionId: input.localConnectionId,
      providerAccountId,
      displayName: input.account.displayName,
      mode: "live",
      accountStatus: input.account.closed ? "closed" : null,
      baseCurrency: input.account.baseCurrency,
      capabilities,
      executionBlockers: input.executionBlockers,
      isDefault: false,
      lastSyncedAt,
    })
    .returning({ id: brokerAccountsTable.id });

  if (!stored) {
    throw new HttpError(500, "Failed to store Schwab broker account", {
      code: "schwab_account_store_failed",
      expose: false,
    });
  }
  return stored.id;
}

export async function syncSchwabConnections(
  options: SyncSchwabConnectionsOptions,
): Promise<SchwabConnectionSyncResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const syncedAt = options.now ?? new Date();
  const accessToken = await getSchwabAccessToken({
    appUserId: options.appUserId,
    env: options.env,
    fetchImpl,
    now: syncedAt,
    encryptionKey: options.encryptionKey,
  });

  const client = new SchwabTraderApiClient({
    accessToken,
    fetchImpl,
    baseUrl: options.baseUrl,
  });
  const [accountNumbers, accountsPayload] = await Promise.all([
    client.getAccountNumbers(),
    client.getAccounts(),
  ]);
  const hashByAccountNumber = new Map(
    accountNumbers.map((mapping) => [mapping.accountNumber, mapping.hashValue]),
  );
  const normalizedAccounts = accountsPayload
    .map((item) => normalizeAccount(item, hashByAccountNumber))
    .filter((account): account is NormalizedAccount => account !== null);

  const localConnectionId = await upsertConnection({
    appUserId: options.appUserId,
    syncedAt,
  });

  const accounts: SchwabConnectionSyncAccount[] = [];
  for (const account of normalizedAccounts) {
    const executionBlockers = accountExecutionBlockers(account);
    accounts.push({
      id: await upsertAccount({
        appUserId: options.appUserId,
        account,
        executionBlockers,
        localConnectionId,
        syncedAt,
      }),
      connectionId: localConnectionId,
      schwabAccountHash: account.hashValue,
      displayName: account.displayName,
      accountType: account.type,
      baseCurrency: account.baseCurrency,
      executionReady: false,
      executionBlockers,
      mode: "live",
      lastSyncedAt: syncedAt.toISOString(),
    });
  }

  const connections: SchwabConnectionSyncConnection[] = [
    {
      id: localConnectionId,
      provider: "schwab",
      connectionKind: "trader_api_oauth",
      status: "connected",
      executionReady: false,
      executionBlockers: [ORDER_TOOLING_UNVERIFIED_BLOCKER],
      accountCount: accounts.length,
      mode: "live",
    },
  ];

  return {
    provider: "schwab",
    syncedAt: syncedAt.toISOString(),
    connections,
    accounts,
    totals: {
      upstreamAccounts: normalizedAccounts.length,
      storedConnections: connections.length,
      storedAccounts: accounts.length,
    },
  };
}
