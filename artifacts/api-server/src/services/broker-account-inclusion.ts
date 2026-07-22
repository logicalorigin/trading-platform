import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";

const PUBLIC_EXECUTION_BLOCKERS = new Set([
  "broker_reauth",
  "broker.connection_not_connected",
  "robinhood.account.agentic_unverified",
  "robinhood.account.archived",
  "robinhood.account.closed",
  "robinhood.account.deactivated",
  "robinhood.account.non_agentic",
  "robinhood.account.status_unverified",
  "schwab.account.closed",
  "schwab.order_tooling_unverified",
  "snaptrade.account.archived",
  "snaptrade.account.closed",
  "snaptrade.brokerage.trading_not_supported",
  "snaptrade.connection.disabled",
  "snaptrade.connection.permission_unknown",
  "snaptrade.connection.read_only",
]);
const EXECUTION_UNAVAILABLE_BLOCKER = "broker.execution_unavailable";
const CONNECTION_NOT_CONNECTED_BLOCKER = "broker.connection_not_connected";

export type BrokerAccountInclusionAccount = {
  id: string;
  providerAccountId: string;
  provider: string | null;
  mode: "live" | "shadow";
  displayName: string;
  accountType: string | null;
  includedInTrading: boolean;
  connectionVerified: boolean;
  executionReady: boolean;
  executionBlockers: string[];
  updatedAt: Date;
};

export type BrokerAccountInclusionResponse = {
  accounts: BrokerAccountInclusionAccount[];
};

export async function listBrokerAccountInclusions(input: {
  appUserId: string;
}): Promise<BrokerAccountInclusionResponse> {
  const rows = await db
    .select({
      id: brokerAccountsTable.id,
      providerAccountId: brokerAccountsTable.providerAccountId,
      provider: brokerConnectionsTable.brokerProvider,
      mode: brokerAccountsTable.mode,
      displayName: brokerAccountsTable.displayName,
      accountType: brokerAccountsTable.accountType,
      includedInTrading: brokerAccountsTable.includedInTrading,
      capabilities: brokerAccountsTable.capabilities,
      executionBlockers: brokerAccountsTable.executionBlockers,
      accountStatus: brokerAccountsTable.accountStatus,
      connectionStatus: brokerConnectionsTable.status,
      updatedAt: brokerAccountsTable.updatedAt,
    })
    .from(brokerAccountsTable)
    .innerJoin(
      brokerConnectionsTable,
      eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
    )
    .where(
      and(
        eq(brokerAccountsTable.appUserId, input.appUserId),
        eq(brokerConnectionsTable.appUserId, input.appUserId),
        eq(brokerConnectionsTable.connectionType, "broker"),
      ),
    )
    .orderBy(
      asc(brokerConnectionsTable.brokerProvider),
      asc(brokerAccountsTable.displayName),
    )
    .limit(1_000);

  return {
    accounts: rows.map(
      ({
        capabilities,
        executionBlockers,
        accountStatus,
        connectionStatus,
        ...account
      }) => {
        const connectionVerified = connectionStatus === "connected";
        const executionReady =
          connectionVerified &&
          capabilities.includes("execution-ready") &&
          executionBlockers.length === 0 &&
          (accountStatus == null || accountStatus === "open");
        const publicBlockers = [
          ...new Set(
            executionBlockers.map((blocker) =>
              PUBLIC_EXECUTION_BLOCKERS.has(blocker)
                ? blocker
                : EXECUTION_UNAVAILABLE_BLOCKER,
            ),
          ),
        ];
        if (
          !connectionVerified &&
          !publicBlockers.includes(CONNECTION_NOT_CONNECTED_BLOCKER)
        ) {
          publicBlockers.unshift(CONNECTION_NOT_CONNECTED_BLOCKER);
        }
        if (!executionReady && publicBlockers.length === 0) {
          publicBlockers.push(
            capabilities.includes("execution-ready")
              ? "account_status_not_open"
              : "execution_ready_capability_missing",
          );
        }
        return {
          ...account,
          connectionVerified,
          executionReady,
          executionBlockers: publicBlockers,
        };
      },
    ),
  };
}

export async function setBrokerAccountInclusions(input: {
  appUserId: string;
  includedAccountIds: string[];
}): Promise<BrokerAccountInclusionResponse> {
  const uniqueIds = [...new Set(input.includedAccountIds)];
  const eligibleConnectionIds = db
    .select({ id: brokerConnectionsTable.id })
    .from(brokerConnectionsTable)
    .where(
      and(
        eq(brokerConnectionsTable.appUserId, input.appUserId),
        eq(brokerConnectionsTable.connectionType, "broker"),
      ),
    );
  const includedInTrading =
    uniqueIds.length > 0
      ? inArray(brokerAccountsTable.id, uniqueIds)
      : sql<boolean>`false`;
  await db
    .update(brokerAccountsTable)
    .set({ includedInTrading, updatedAt: new Date() })
    .where(
      and(
        eq(brokerAccountsTable.appUserId, input.appUserId),
        inArray(brokerAccountsTable.connectionId, eligibleConnectionIds),
      ),
    );

  return listBrokerAccountInclusions({ appUserId: input.appUserId });
}
