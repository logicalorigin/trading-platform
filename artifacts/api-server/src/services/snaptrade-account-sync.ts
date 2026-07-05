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

export type SnapTradeBrokerageConnectionSyncConnection = {
  id: string;
  provider: "snaptrade";
  snapTradeConnectionId: string;
  brokerageSlug: string | null;
  brokerageName: string;
  connectionType: "read" | "trade" | "unknown";
  status: "connected" | "disconnected" | "error";
  tradeEnabled: boolean | null;
  executionReady: boolean;
  executionBlockers: string[];
  accountCount: number;
  mode: "live";
};

export type SnapTradeBrokerageConnectionSyncAccount = {
  id: string;
  connectionId: string;
  snapTradeAccountId: string;
  displayName: string;
  brokerageName: string | null;
  status: "open" | "closed" | "archived" | null;
  baseCurrency: string;
  executionReady: boolean;
  executionBlockers: string[];
  mode: "live";
  lastSyncedAt: string;
};

export type SnapTradeBrokerageConnectionSyncResponse = {
  provider: "snaptrade";
  syncedAt: string;
  connections: SnapTradeBrokerageConnectionSyncConnection[];
  accounts: SnapTradeBrokerageConnectionSyncAccount[];
  totals: {
    upstreamConnections: number;
    upstreamAccounts: number;
    storedConnections: number;
    storedAccounts: number;
  };
};

export type SyncSnapTradeBrokerageConnectionsOptions = {
  appUserId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
};

type SnapTradeCredentials = {
  clientId: string;
  consumerKey: string;
};

type NormalizedConnection = {
  snapTradeConnectionId: string;
  brokerageSlug: string | null;
  brokerageName: string;
  connectionType: "read" | "trade" | "unknown";
  status: "connected" | "disconnected" | "error";
  tradeEnabled: boolean | null;
  disabled: boolean;
  brokerageAllowsTrading: boolean | null;
  executionReady: boolean;
  executionBlockers: string[];
};

type StoredConnection = NormalizedConnection & {
  localConnectionId: string;
  accountCount: number;
};

type NormalizedAccount = {
  snapTradeAccountId: string;
  snapTradeConnectionId: string;
  displayName: string;
  brokerageName: string | null;
  status: "open" | "closed" | "archived" | null;
  baseCurrency: string;
};

type AccountForStorage = NormalizedAccount & {
  executionReady: boolean;
  executionBlockers: string[];
};

const SNAPTRADE_AUTHORIZATIONS_PATH = "/authorizations";
const SNAPTRADE_ACCOUNTS_PATH = "/accounts";
const LOCAL_ID_PREFIX = "snaptrade:";
const MAX_PROVIDER_ID_LENGTH = 128 - LOCAL_ID_PREFIX.length;

function readEnvString(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string,
): string {
  return env[key]?.trim() ?? "";
}

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

function localSnapTradeProviderId(value: string): string {
  if (value.length > MAX_PROVIDER_ID_LENGTH) {
    throw new HttpError(502, "SnapTrade account sync returned invalid data", {
      code: "snaptrade_account_sync_invalid_response",
      expose: false,
    });
  }
  return `${LOCAL_ID_PREFIX}${value}`;
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
}): string {
  const query = new URLSearchParams();
  query.set("clientId", input.clientId);
  query.set("timestamp", input.timestamp);
  query.set("userId", input.snapTradeUserId);
  query.set("userSecret", input.userSecret);
  return query.toString();
}

async function fetchSnapTradeJson(input: {
  path: string;
  query: string;
  consumerKey: string;
  fetchImpl: typeof fetch;
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
    throw new HttpError(502, "SnapTrade account sync failed", {
      code: "snaptrade_account_sync_network_error",
      expose: false,
    });
  }

  if (!response.ok) {
    throw new HttpError(502, "SnapTrade account sync failed", {
      code: "snaptrade_account_sync_failed",
      expose: false,
      data: { path: input.path, status: response.status },
    });
  }

  return payload;
}

function parseArrayPayload(payload: unknown): unknown[] {
  if (!Array.isArray(payload)) {
    throw new HttpError(502, "SnapTrade account sync returned invalid data", {
      code: "snaptrade_account_sync_invalid_response",
      expose: false,
    });
  }
  return payload;
}

function snapTradeId(record: Record<string, unknown>, keys: string[]): string {
  const id = readString(record, keys);
  if (!id || id.length > MAX_PROVIDER_ID_LENGTH) {
    throw new HttpError(502, "SnapTrade account sync returned invalid data", {
      code: "snaptrade_account_sync_invalid_response",
      expose: false,
    });
  }
  return id;
}

function normalizeStatus(
  record: Record<string, unknown>,
): "connected" | "disconnected" | "error" {
  const rawStatus = readString(record, ["status", "state"])?.toLowerCase() ?? "";
  if (rawStatus.includes("error") || rawStatus.includes("failed")) {
    return "error";
  }
  if (
    record["disabled"] === true ||
    rawStatus.includes("disabled") ||
    rawStatus.includes("disconnect")
  ) {
    return "disconnected";
  }
  return "connected";
}

function normalizeConnectionType(
  record: Record<string, unknown>,
): "read" | "trade" | "unknown" {
  const explicit = record["trade_enabled"] ?? record["tradeEnabled"];
  if (typeof explicit === "boolean") {
    return explicit ? "trade" : "read";
  }

  const connectionType = readString(record, [
    "connectionType",
    "connection_type",
    "type",
  ])?.toLowerCase();
  if (connectionType === "trade") {
    return "trade";
  }
  if (connectionType === "read") {
    return "read";
  }
  return "unknown";
}

function connectionTypeTradeEnabled(
  connectionType: "read" | "trade" | "unknown",
): boolean | null {
  if (connectionType === "trade") {
    return true;
  }
  if (connectionType === "read") {
    return false;
  }
  return null;
}

function connectionExecutionBlockers(input: {
  connectionType: "read" | "trade" | "unknown";
  disabled: boolean;
  brokerageAllowsTrading: boolean | null;
}): string[] {
  const blockers: string[] = [];
  if (input.disabled) {
    blockers.push("snaptrade.connection.disabled");
  }
  if (input.connectionType === "read") {
    blockers.push("snaptrade.connection.read_only");
  } else if (input.connectionType === "unknown") {
    blockers.push("snaptrade.connection.permission_unknown");
  }
  if (input.brokerageAllowsTrading === false) {
    blockers.push("snaptrade.brokerage.trading_not_supported");
  }
  return blockers;
}

function normalizeConnection(value: unknown): NormalizedConnection {
  const record = asRecord(value);
  const brokerage = asRecord(record["brokerage"]);
  const connectionType = normalizeConnectionType(record);
  const disabled = readBoolean(record, ["disabled"]) === true;
  const brokerageAllowsTrading = readBoolean(brokerage, [
    "allows_trading",
    "allowsTrading",
  ]);
  const executionBlockers = connectionExecutionBlockers({
    connectionType,
    disabled,
    brokerageAllowsTrading,
  });
  const snapTradeConnectionId = snapTradeId(record, [
    "id",
    "brokerage_authorization_id",
    "authorizationId",
  ]);
  const brokerageSlug =
    readString(brokerage, ["slug", "id"]) ??
    readString(record, ["brokerage_slug", "brokerageSlug"]);
  const brokerageName =
    readString(brokerage, ["name", "display_name", "displayName"]) ??
    readString(record, [
      "brokerage_name",
      "brokerageName",
      "institution_name",
      "institutionName",
      "name",
    ]) ??
    "SnapTrade brokerage";

  return {
    snapTradeConnectionId,
    brokerageSlug,
    brokerageName,
    connectionType,
    status: normalizeStatus(record),
    tradeEnabled: connectionTypeTradeEnabled(connectionType),
    disabled,
    brokerageAllowsTrading,
    executionReady: executionBlockers.length === 0,
    executionBlockers,
  };
}

function accountConnectionId(record: Record<string, unknown>): string | null {
  const direct = readString(record, [
    "brokerage_authorization",
    "brokerage_authorization_id",
    "brokerageAuthorization",
    "brokerageAuthorizationId",
    "connection_id",
    "connectionId",
  ]);
  if (direct) {
    return direct;
  }

  for (const key of ["brokerage_authorization", "brokerageAuthorization"]) {
    const nested = asRecord(record[key]);
    const nestedId = readString(nested, ["id"]);
    if (nestedId) {
      return nestedId;
    }
  }
  return null;
}

function redactAccountDigits(value: string): string {
  return value.replace(/[A-Za-z]?\d{5,}/gu, (match) => `...${match.slice(-4)}`);
}

function safeDisplayName(value: unknown): string | null {
  const text = nonEmptyString(value);
  if (!text) {
    return null;
  }
  return redactAccountDigits(text).slice(0, 160);
}

function accountLastFour(record: Record<string, unknown>): string | null {
  const rawNumber = readString(record, [
    "number",
    "account_number",
    "accountNumber",
    "institutionAccountId",
  ]);
  if (!rawNumber) {
    return null;
  }
  const digits = rawNumber.replace(/\D/gu, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function normalizeCurrency(record: Record<string, unknown>): string {
  const currency =
    readNestedString(record, ["balance", "currency", "code"]) ??
    readNestedString(record, ["balance", "currency"]) ??
    readNestedString(record, ["currency", "code"]) ??
    readString(record, ["currency", "base_currency", "baseCurrency"]);
  if (!currency || !/^[A-Za-z]{2,16}$/u.test(currency)) {
    return "USD";
  }
  return currency.toUpperCase();
}

function normalizeAccountStatus(
  record: Record<string, unknown>,
): "open" | "closed" | "archived" | null {
  const rawStatus = readString(record, ["status"])?.toLowerCase();
  if (
    rawStatus === "open" ||
    rawStatus === "closed" ||
    rawStatus === "archived"
  ) {
    return rawStatus;
  }
  return null;
}

function normalizeAccount(
  value: unknown,
  connectionBySnapTradeId: Map<string, NormalizedConnection>,
): NormalizedAccount {
  const record = asRecord(value);
  const snapTradeAccountId = snapTradeId(record, ["id", "accountId"]);
  const snapTradeConnectionId = accountConnectionId(record);
  if (!snapTradeConnectionId) {
    throw new HttpError(502, "SnapTrade account sync returned invalid data", {
      code: "snaptrade_account_sync_invalid_response",
      expose: false,
    });
  }

  const connection = connectionBySnapTradeId.get(snapTradeConnectionId);
  const brokerageName =
    readString(record, [
      "institution_name",
      "institutionName",
      "brokerage_name",
      "brokerageName",
    ]) ??
    connection?.brokerageName ??
    null;
  const lastFour = accountLastFour(record);
  const displayName =
    safeDisplayName(record["name"]) ??
    safeDisplayName(record["display_name"]) ??
    (lastFour
      ? `${brokerageName ?? "SnapTrade"} account ...${lastFour}`
      : `${brokerageName ?? "SnapTrade"} account`);

  return {
    snapTradeAccountId,
    snapTradeConnectionId,
    displayName,
    brokerageName,
    status: normalizeAccountStatus(record),
    baseCurrency: normalizeCurrency(record),
  };
}

function connectionCapabilities(connection: NormalizedConnection): string[] {
  const capabilities = ["accounts", "positions", "snaptrade"];
  if (connection.brokerageSlug) {
    capabilities.push(`snaptrade-brokerage:${connection.brokerageSlug}`);
  }
  if (connection.executionReady) {
    capabilities.push("orders", "executions", "execution-ready");
  } else if (connection.tradeEnabled === false) {
    capabilities.push("read-only");
  }
  return capabilities;
}

function accountExecutionBlockers(
  account: NormalizedAccount,
  connection: NormalizedConnection,
): string[] {
  const blockers = [...connection.executionBlockers];
  if (account.status === "closed") {
    blockers.push("snaptrade.account.closed");
  } else if (account.status === "archived") {
    blockers.push("snaptrade.account.archived");
  }
  return blockers;
}

function accountCapabilities(account: AccountForStorage): string[] {
  const capabilities = ["accounts", "positions", "snaptrade"];
  if (account.executionReady) {
    capabilities.push("orders", "executions", "execution-ready");
  }
  return capabilities;
}

async function upsertConnection(input: {
  appUserId: string;
  connection: NormalizedConnection;
  syncedAt: Date;
}): Promise<string> {
  const name = localSnapTradeProviderId(input.connection.snapTradeConnectionId);
  const capabilities = connectionCapabilities(input.connection);
  const [existing] = await db
    .select({ id: brokerConnectionsTable.id })
    .from(brokerConnectionsTable)
    .where(
      and(
        eq(brokerConnectionsTable.appUserId, input.appUserId),
        eq(brokerConnectionsTable.connectionType, "broker"),
        eq(brokerConnectionsTable.mode, "live"),
        eq(brokerConnectionsTable.name, name),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(brokerConnectionsTable)
      .set({
        brokerProvider: "snaptrade",
        status: input.connection.status,
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
      name,
      connectionType: "broker",
      brokerProvider: "snaptrade",
      mode: "live",
      status: input.connection.status,
      capabilities,
      isDefault: false,
    })
    .returning({ id: brokerConnectionsTable.id });

  if (!stored) {
    throw new HttpError(500, "Failed to store SnapTrade broker connection", {
      code: "snaptrade_connection_store_failed",
      expose: false,
    });
  }
  return stored.id;
}

async function upsertAccount(input: {
  appUserId: string;
  account: AccountForStorage;
  localConnectionId: string;
  syncedAt: Date;
}): Promise<string> {
  const lastSyncedAt = input.syncedAt.toISOString();
  const providerAccountId = localSnapTradeProviderId(
    input.account.snapTradeAccountId,
  );
  const capabilities = accountCapabilities(input.account);
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
        executionBlockers: input.account.executionBlockers,
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
      executionBlockers: input.account.executionBlockers,
      isDefault: false,
      lastSyncedAt,
    })
    .returning({ id: brokerAccountsTable.id });

  if (!stored) {
    throw new HttpError(500, "Failed to store SnapTrade broker account", {
      code: "snaptrade_account_store_failed",
      expose: false,
    });
  }
  return stored.id;
}

export async function syncSnapTradeBrokerageConnections(
  options: SyncSnapTradeBrokerageConnectionsOptions,
): Promise<SnapTradeBrokerageConnectionSyncResponse> {
  const credential = await loadSnapTradeUserCredential({
    appUserId: options.appUserId,
    encryptionKey: options.encryptionKey,
  });
  if (!credential) {
    throw new HttpError(409, "SnapTrade user is not registered", {
      code: "snaptrade_user_not_registered",
    });
  }

  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const syncedAt = options.now ?? new Date();
  const { clientId, consumerKey } = configuredSnapTradeCredentials(env);
  const query = buildUserScopedQuery({
    clientId,
    timestamp: Math.floor(syncedAt.getTime() / 1000).toString(),
    snapTradeUserId: credential.snapTradeUserId,
    userSecret: credential.userSecret,
  });

  const [connectionsPayload, accountsPayload] = await Promise.all([
    fetchSnapTradeJson({
      path: SNAPTRADE_AUTHORIZATIONS_PATH,
      query,
      consumerKey,
      fetchImpl,
    }),
    fetchSnapTradeJson({
      path: SNAPTRADE_ACCOUNTS_PATH,
      query,
      consumerKey,
      fetchImpl,
    }),
  ]);

  const normalizedConnections = parseArrayPayload(connectionsPayload).map(
    normalizeConnection,
  );
  const connectionBySnapTradeId = new Map(
    normalizedConnections.map((connection) => [
      connection.snapTradeConnectionId,
      connection,
    ]),
  );
  const normalizedAccounts = parseArrayPayload(accountsPayload).map((account) =>
    normalizeAccount(account, connectionBySnapTradeId),
  );

  const storedConnectionBySnapTradeId = new Map<string, StoredConnection>();
  for (const connection of normalizedConnections) {
    storedConnectionBySnapTradeId.set(connection.snapTradeConnectionId, {
      ...connection,
      localConnectionId: await upsertConnection({
        appUserId: options.appUserId,
        connection,
        syncedAt,
      }),
      accountCount: normalizedAccounts.filter(
        (account) =>
          account.snapTradeConnectionId === connection.snapTradeConnectionId,
      ).length,
    });
  }

  const accounts: SnapTradeBrokerageConnectionSyncAccount[] = [];
  for (const account of normalizedAccounts) {
    const storedConnection = storedConnectionBySnapTradeId.get(
      account.snapTradeConnectionId,
    );
    if (!storedConnection) {
      throw new HttpError(502, "SnapTrade account sync returned invalid data", {
        code: "snaptrade_account_sync_invalid_response",
        expose: false,
      });
    }
    const executionBlockers = accountExecutionBlockers(
      account,
      storedConnection,
    );
    const accountForStorage: AccountForStorage = {
      ...account,
      executionReady: executionBlockers.length === 0,
      executionBlockers,
    };
    accounts.push({
      id: await upsertAccount({
        appUserId: options.appUserId,
        account: accountForStorage,
        localConnectionId: storedConnection.localConnectionId,
        syncedAt,
      }),
      connectionId: storedConnection.localConnectionId,
      snapTradeAccountId: account.snapTradeAccountId,
      displayName: account.displayName,
      brokerageName: account.brokerageName,
      status: account.status,
      baseCurrency: account.baseCurrency,
      executionReady: accountForStorage.executionReady,
      executionBlockers: accountForStorage.executionBlockers,
      mode: "live",
      lastSyncedAt: syncedAt.toISOString(),
    });
  }

  const connections: SnapTradeBrokerageConnectionSyncConnection[] = [
    ...storedConnectionBySnapTradeId.values(),
  ].map((connection) => ({
    id: connection.localConnectionId,
    provider: "snaptrade",
    snapTradeConnectionId: connection.snapTradeConnectionId,
    brokerageSlug: connection.brokerageSlug,
    brokerageName: connection.brokerageName,
    connectionType: connection.connectionType,
    status: connection.status,
    tradeEnabled: connection.tradeEnabled,
    executionReady: connection.executionReady,
    executionBlockers: connection.executionBlockers,
    accountCount: connection.accountCount,
    mode: "live",
  }));

  return {
    provider: "snaptrade",
    syncedAt: syncedAt.toISOString(),
    connections,
    accounts,
    totals: {
      upstreamConnections: normalizedConnections.length,
      upstreamAccounts: normalizedAccounts.length,
      storedConnections: connections.length,
      storedAccounts: accounts.length,
    },
  };
}
