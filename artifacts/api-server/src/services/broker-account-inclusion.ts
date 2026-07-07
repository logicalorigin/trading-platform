import { and, asc, eq, inArray, not } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";

export type BrokerAccountInclusionAccount = {
  id: string;
  providerAccountId: string;
  provider: string | null;
  mode: "live" | "shadow";
  displayName: string;
  accountType: string | null;
  includedInTrading: boolean;
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
      updatedAt: brokerAccountsTable.updatedAt,
    })
    .from(brokerAccountsTable)
    .innerJoin(
      brokerConnectionsTable,
      eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
    )
    .where(eq(brokerAccountsTable.appUserId, input.appUserId))
    .orderBy(
      asc(brokerConnectionsTable.brokerProvider),
      asc(brokerAccountsTable.displayName),
    )
    .limit(1_000);

  return { accounts: rows };
}

export async function setBrokerAccountInclusions(input: {
  appUserId: string;
  includedAccountIds: string[];
}): Promise<BrokerAccountInclusionResponse> {
  const uniqueIds = [...new Set(input.includedAccountIds)];
  if (uniqueIds.length > 0) {
    await db
      .update(brokerAccountsTable)
      .set({ includedInTrading: true, updatedAt: new Date() })
      .where(
        and(
          eq(brokerAccountsTable.appUserId, input.appUserId),
          inArray(brokerAccountsTable.id, uniqueIds),
        ),
      );
    await db
      .update(brokerAccountsTable)
      .set({ includedInTrading: false, updatedAt: new Date() })
      .where(
        and(
          eq(brokerAccountsTable.appUserId, input.appUserId),
          not(inArray(brokerAccountsTable.id, uniqueIds)),
        ),
      );
  } else {
    await db
      .update(brokerAccountsTable)
      .set({ includedInTrading: false, updatedAt: new Date() })
      .where(eq(brokerAccountsTable.appUserId, input.appUserId));
  }

  return listBrokerAccountInclusions({ appUserId: input.appUserId });
}
