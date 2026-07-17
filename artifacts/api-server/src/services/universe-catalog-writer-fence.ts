import { and, eq, sql } from "drizzle-orm";

import {
  db,
  universeCatalogSyncStatesTable,
  type WorkspaceDatabase,
} from "@workspace/db";

export const UNIVERSE_CATALOG_WRITER_FENCE_SCOPE_KEY = "catalog:writer";
export const UNIVERSE_CATALOG_WRITER_ADVISORY_LOCK_KEY = 1_930_514_024;

type WorkspaceTransaction = Parameters<
  Parameters<WorkspaceDatabase["transaction"]>[0]
>[0];

function assertCanonicalFenceToken(fenceToken: string): void {
  if (!/^[1-9]\d*$/u.test(fenceToken)) {
    throw new Error("Universe-catalog writer fence token is invalid.");
  }
}

export function requireUniverseCatalogWriterFenceToken(lease: {
  readonly fenceToken?: string;
}): string {
  const fenceToken = lease.fenceToken;
  if (!fenceToken) {
    throw new Error("Universe-catalog advisory lease has no fence token.");
  }
  assertCanonicalFenceToken(fenceToken);
  return fenceToken;
}

export async function claimUniverseCatalogWriterFence(input: {
  fenceToken: string;
  database?: WorkspaceDatabase;
}): Promise<void> {
  assertCanonicalFenceToken(input.fenceToken);
  const database = input.database ?? db;
  const now = new Date();
  const rows = await database
    .insert(universeCatalogSyncStatesTable)
    .values({
      scopeKey: UNIVERSE_CATALOG_WRITER_FENCE_SCOPE_KEY,
      phase: "writer",
      market: "stocks",
      activeOnly: true,
      metadata: { leaseFenceToken: input.fenceToken },
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: universeCatalogSyncStatesTable.scopeKey,
      set: {
        metadata: { leaseFenceToken: input.fenceToken },
        updatedAt: now,
      },
      setWhere: sql`case
        when coalesce(${universeCatalogSyncStatesTable.metadata}->>'leaseFenceToken', '') ~ '^[1-9][0-9]*$'
          then (${universeCatalogSyncStatesTable.metadata}->>'leaseFenceToken')::numeric
        else 0
      end <= ${input.fenceToken}::numeric`,
    })
    .returning({ scopeKey: universeCatalogSyncStatesTable.scopeKey });
  if (!rows.length) {
    throw new Error("Universe-catalog writer lease was superseded.");
  }
}

export async function assertUniverseCatalogWriterFence(input: {
  fenceToken: string;
  transaction: WorkspaceTransaction;
}): Promise<void> {
  assertCanonicalFenceToken(input.fenceToken);
  const rows = await input.transaction
    .select({ scopeKey: universeCatalogSyncStatesTable.scopeKey })
    .from(universeCatalogSyncStatesTable)
    .where(
      and(
        eq(
          universeCatalogSyncStatesTable.scopeKey,
          UNIVERSE_CATALOG_WRITER_FENCE_SCOPE_KEY,
        ),
        sql`${universeCatalogSyncStatesTable.metadata}->>'leaseFenceToken' = ${input.fenceToken}`,
      ),
    )
    .for("update");
  if (!rows.length) {
    throw new Error("Universe-catalog writer lease was superseded.");
  }
}
