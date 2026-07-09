import { and, eq } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { RobinhoodMcpSession } from "../providers/robinhood/mcp-client";
import { getRobinhoodAccessToken } from "./robinhood-oauth";

export type RobinhoodConnectionSyncConnection = {
  id: string;
  provider: "robinhood";
  connectionKind: "agentic_oauth";
  status: "connected" | "disconnected" | "error";
  executionReady: boolean;
  executionBlockers: string[];
  accountCount: number;
  mode: "live";
};

export type RobinhoodConnectionSyncAccount = {
  id: string;
  connectionId: string;
  robinhoodAccountId: string;
  displayName: string;
  agentic: boolean | null;
  status: "open" | "closed" | "archived" | null;
  baseCurrency: string;
  // Robinhood options approval tier from get_accounts (e.g. "option_level_2").
  // Empty string when options are not approved for the account.
  optionLevel: string;
  executionReady: boolean;
  executionBlockers: string[];
  mode: "live";
  lastSyncedAt: string;
};

export type RobinhoodConnectionSyncResponse = {
  provider: "robinhood";
  syncedAt: string;
  connections: RobinhoodConnectionSyncConnection[];
  accounts: RobinhoodConnectionSyncAccount[];
  totals: {
    upstreamAccounts: number;
    storedConnections: number;
    storedAccounts: number;
  };
};

export type SyncRobinhoodConnectionsOptions = {
  appUserId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  mcpUrl?: string;
};

type NormalizedAccount = {
  robinhoodAccountId: string;
  displayName: string;
  agentic: boolean | null;
  status: "open" | "closed" | "archived" | null;
  deactivated: boolean;
  baseCurrency: string;
  optionLevel: string;
};

const LOCAL_ID_PREFIX = "robinhood:";
const MAX_PROVIDER_ID_LENGTH = 128 - LOCAL_ID_PREFIX.length;
const CONNECTION_NAME = "robinhood:agentic";

// Base capabilities every synced Robinhood account carries; agentic accounts
// additionally get order/execution capabilities once the account passes the
// execution-ready gate below.
const ACCOUNT_BASE_CAPABILITIES = ["accounts", "positions", "robinhood"];
const CONNECTION_BASE_CAPABILITIES = [
  "accounts",
  "positions",
  "robinhood",
  "robinhood-agentic",
];
// Marker persisted on the account row so the order service can assert
// agentic_allowed without an extra get_accounts MCP round-trip.
const AGENTIC_CAPABILITY = "robinhood-agentic";
const EXECUTION_CAPABILITIES = ["orders", "executions", "execution-ready"];
// Options approval tier persisted on the account row (no schema migration) so
// the settings UI and order tooling can read the tier without an extra
// get_accounts round-trip. Only tagged when the account carries an approval.
const OPTION_LEVEL_CAPABILITY_PREFIX = "robinhood-option-level:";

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

function readBoolean(
  record: Record<string, unknown>,
  keys: string[],
): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function invalidResponse(): HttpError {
  return new HttpError(502, "Robinhood account sync returned invalid data", {
    code: "robinhood_account_sync_invalid_response",
    expose: false,
  });
}

function extractAccountsPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const record = asRecord(payload);
  for (const key of ["accounts", "results", "data"]) {
    if (Array.isArray(record[key])) {
      return record[key];
    }
  }
  // Robinhood MCP get_accounts nests the list: { data: { accounts: [...] } }.
  const nested = asRecord(record["data"]);
  for (const key of ["accounts", "results"]) {
    if (Array.isArray(nested[key])) {
      return nested[key];
    }
  }
  throw invalidResponse();
}

function redactAccountDigits(value: string): string {
  return value.replace(/[A-Za-z]?\d{5,}/gu, (match) => `...${match.slice(-4)}`);
}

function accountLastFour(record: Record<string, unknown>): string | null {
  const rawNumber = readString(record, [
    "account_number",
    "accountNumber",
    "number",
  ]);
  if (!rawNumber) {
    return null;
  }
  const digits = rawNumber.replace(/\D/gu, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function detectAgentic(record: Record<string, unknown>): boolean | null {
  const explicit = readBoolean(record, [
    "agentic_allowed",
    "agenticAllowed",
    "is_agentic",
    "isAgentic",
    "agentic",
  ]);
  if (explicit !== null) {
    return explicit;
  }
  const typeText = readString(record, [
    "type",
    "account_type",
    "accountType",
    "brokerage_account_type",
    "brokerageAccountType",
    "nickname",
    "name",
    "display_name",
    "displayName",
  ]);
  if (typeText && typeText.toLowerCase().includes("agentic")) {
    return true;
  }
  return null;
}

function normalizeAccountStatus(
  record: Record<string, unknown>,
): "open" | "closed" | "archived" | null {
  const rawStatus = readString(record, ["status", "state"])?.toLowerCase();
  if (
    rawStatus === "open" ||
    rawStatus === "closed" ||
    rawStatus === "archived"
  ) {
    return rawStatus;
  }
  if (rawStatus === "active") {
    return "open";
  }
  return null;
}

function normalizeCurrency(record: Record<string, unknown>): string {
  const currency = readString(record, [
    "currency",
    "base_currency",
    "baseCurrency",
    "currency_code",
    "currencyCode",
  ]);
  if (!currency || !/^[A-Za-z]{2,16}$/u.test(currency)) {
    return "USD";
  }
  return currency.toUpperCase();
}

function normalizeAccount(value: unknown): NormalizedAccount {
  const record = asRecord(value);
  const robinhoodAccountId = readString(record, [
    "id",
    "account_id",
    "accountId",
    "account_number",
    "accountNumber",
  ]);
  if (!robinhoodAccountId || robinhoodAccountId.length > MAX_PROVIDER_ID_LENGTH) {
    throw invalidResponse();
  }

  const agentic = detectAgentic(record);
  const lastFour = accountLastFour(record);
  const rawName =
    readString(record, ["name", "display_name", "displayName", "nickname"]) ??
    null;
  const displayName = rawName
    ? redactAccountDigits(rawName).slice(0, 160)
    : lastFour
      ? `Robinhood ${agentic ? "Agentic " : ""}account ...${lastFour}`
      : `Robinhood ${agentic ? "Agentic " : ""}account`;

  return {
    robinhoodAccountId,
    displayName,
    agentic,
    status: normalizeAccountStatus(record),
    deactivated:
      readBoolean(record, ["deactivated", "is_deactivated", "isDeactivated"]) ===
      true,
    baseCurrency: normalizeCurrency(record),
    optionLevel: readString(record, ["option_level", "optionLevel"]) ?? "",
  };
}

function accountExecutionBlockers(account: NormalizedAccount): string[] {
  const blockers: string[] = [];
  if (account.agentic === false) {
    blockers.push("robinhood.account.non_agentic");
  } else if (account.agentic === null) {
    blockers.push("robinhood.account.agentic_unverified");
  }
  if (account.deactivated) {
    blockers.push("robinhood.account.deactivated");
  }
  if (account.status === "closed") {
    blockers.push("robinhood.account.closed");
  } else if (account.status === "archived") {
    blockers.push("robinhood.account.archived");
  } else if (account.status === null) {
    blockers.push("robinhood.account.status_unverified");
  }
  return blockers;
}

// Order tooling is schema-verified for agentic accounts (review/place/cancel
// equity). An account is execution-ready iff it is agentic, open, not
// deactivated, and carries no other blocker.
function accountExecutionReady(
  account: NormalizedAccount,
  executionBlockers: string[],
): boolean {
  return (
    account.agentic === true &&
    account.status === "open" &&
    !account.deactivated &&
    executionBlockers.length === 0
  );
}

function accountCapabilities(
  executionReady: boolean,
  optionLevel: string,
): string[] {
  const capabilities = executionReady
    ? [...ACCOUNT_BASE_CAPABILITIES, AGENTIC_CAPABILITY, ...EXECUTION_CAPABILITIES]
    : [...ACCOUNT_BASE_CAPABILITIES];
  if (optionLevel) {
    capabilities.push(`${OPTION_LEVEL_CAPABILITY_PREFIX}${optionLevel}`);
  }
  return capabilities;
}

async function upsertConnection(input: {
  appUserId: string;
  capabilities: string[];
  syncedAt: Date;
}): Promise<string> {
  const capabilities = input.capabilities;
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
        brokerProvider: "robinhood",
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
      brokerProvider: "robinhood",
      mode: "live",
      status: "connected",
      capabilities,
      isDefault: false,
    })
    .returning({ id: brokerConnectionsTable.id });

  if (!stored) {
    throw new HttpError(500, "Failed to store Robinhood broker connection", {
      code: "robinhood_connection_store_failed",
      expose: false,
    });
  }
  return stored.id;
}

async function upsertAccount(input: {
  appUserId: string;
  account: NormalizedAccount;
  capabilities: string[];
  executionBlockers: string[];
  localConnectionId: string;
  syncedAt: Date;
}): Promise<string> {
  const lastSyncedAt = input.syncedAt.toISOString();
  const providerAccountId = `${LOCAL_ID_PREFIX}${input.account.robinhoodAccountId}`;
  const capabilities = input.capabilities;
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
        accountStatus: input.account.status,
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
      accountStatus: input.account.status,
      baseCurrency: input.account.baseCurrency,
      capabilities,
      executionBlockers: input.executionBlockers,
      isDefault: false,
      lastSyncedAt,
    })
    .returning({ id: brokerAccountsTable.id });

  if (!stored) {
    throw new HttpError(500, "Failed to store Robinhood broker account", {
      code: "robinhood_account_store_failed",
      expose: false,
    });
  }
  return stored.id;
}

export async function syncRobinhoodConnections(
  options: SyncRobinhoodConnectionsOptions,
): Promise<RobinhoodConnectionSyncResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const syncedAt = options.now ?? new Date();
  const accessToken = await getRobinhoodAccessToken({
    appUserId: options.appUserId,
    env: options.env,
    fetchImpl,
    now: syncedAt,
    encryptionKey: options.encryptionKey,
  });

  const session = new RobinhoodMcpSession({
    accessToken,
    fetchImpl,
    mcpUrl: options.mcpUrl,
  });
  const accountsPayload = await session.callTool({ name: "get_accounts" });
  const normalizedAccounts = extractAccountsPayload(accountsPayload).map(
    normalizeAccount,
  );

  const evaluated = normalizedAccounts.map((account) => {
    const executionBlockers = accountExecutionBlockers(account);
    const executionReady = accountExecutionReady(account, executionBlockers);
    return {
      account,
      executionBlockers,
      executionReady,
      capabilities: accountCapabilities(executionReady, account.optionLevel),
    };
  });
  const anyExecutionReady = evaluated.some((entry) => entry.executionReady);

  const localConnectionId = await upsertConnection({
    appUserId: options.appUserId,
    capabilities: anyExecutionReady
      ? [...CONNECTION_BASE_CAPABILITIES, ...EXECUTION_CAPABILITIES]
      : [...CONNECTION_BASE_CAPABILITIES],
    syncedAt,
  });

  const accounts: RobinhoodConnectionSyncAccount[] = [];
  for (const entry of evaluated) {
    accounts.push({
      id: await upsertAccount({
        appUserId: options.appUserId,
        account: entry.account,
        capabilities: entry.capabilities,
        executionBlockers: entry.executionBlockers,
        localConnectionId,
        syncedAt,
      }),
      connectionId: localConnectionId,
      robinhoodAccountId: entry.account.robinhoodAccountId,
      displayName: entry.account.displayName,
      agentic: entry.account.agentic,
      status: entry.account.status,
      baseCurrency: entry.account.baseCurrency,
      optionLevel: entry.account.optionLevel,
      executionReady: entry.executionReady,
      executionBlockers: entry.executionBlockers,
      mode: "live",
      lastSyncedAt: syncedAt.toISOString(),
    });
  }

  const connections: RobinhoodConnectionSyncConnection[] = [
    {
      id: localConnectionId,
      provider: "robinhood",
      connectionKind: "agentic_oauth",
      status: "connected",
      executionReady: anyExecutionReady,
      executionBlockers: anyExecutionReady
        ? []
        : ["robinhood.no_execution_ready_account"],
      accountCount: accounts.length,
      mode: "live",
    },
  ];

  return {
    provider: "robinhood",
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
