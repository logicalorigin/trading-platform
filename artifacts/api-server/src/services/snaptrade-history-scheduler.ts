import { and, eq, isNotNull } from "drizzle-orm";

import { brokerAccountsTable, brokerConnectionsTable, db } from "@workspace/db";
import * as dbExports from "@workspace/db";
import { logger } from "../lib/logger";
import { ingestSnapTradeAccountHistory } from "./snaptrade-account-history";
import { isApiResourcePressureHardBlock } from "./resource-pressure";

// Proactive SnapTrade backfill. The per-account history endpoint persists activity
// + balance history as a side effect, but only when a user opens that account's
// page. This worker pulls every connected SnapTrade account's history from the
// broker on a schedule (and on connect, via refreshSnapTradeAccountHistoryForUser),
// so past P&L populates automatically and stays fresh without any page open.
// Mirrors startAccountFlexRefreshScheduler for IBKR Flex.

const SNAPTRADE_HISTORY_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h
// Stagger past the connect herd + other DB-touching workers that start at boot.
const SNAPTRADE_HISTORY_INITIAL_DELAY_MS = 45_000;
type DbLaneRunner = <T>(lane: "bulk", fn: () => T) => T;
const runInDbLane = (
  dbExports as typeof dbExports & { runInDbLane: DbLaneRunner }
).runInDbLane;

function snapTradeConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env["SNAPTRADE_CLIENTID"]?.trim() && env["SNAPTRADE_API_KEY"]?.trim());
}

function shouldSkipSnapTradeHistoryRefreshForPressure(): boolean {
  return isApiResourcePressureHardBlock();
}

type SnapTradeAccountRef = { accountId: string; appUserId: string };

async function listSnapTradeAccountsForRefresh(
  appUserId?: string,
): Promise<SnapTradeAccountRef[]> {
  const filters = [
    eq(brokerConnectionsTable.brokerProvider, "snaptrade"),
    isNotNull(brokerAccountsTable.appUserId),
  ];
  if (appUserId) {
    filters.push(eq(brokerAccountsTable.appUserId, appUserId));
  }
  const rows = await db
    .select({
      accountId: brokerAccountsTable.id,
      appUserId: brokerAccountsTable.appUserId,
    })
    .from(brokerAccountsTable)
    .innerJoin(
      brokerConnectionsTable,
      eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
    )
    .where(and(...filters));
  return rows.filter(
    (row): row is SnapTradeAccountRef => typeof row.appUserId === "string",
  );
}

export type SnapTradeHistoryRefreshSummary = {
  accounts: number;
  succeeded: number;
  failed: number;
  activitiesStored: number;
};

async function refreshAccounts(
  refs: SnapTradeAccountRef[],
): Promise<SnapTradeHistoryRefreshSummary> {
  let succeeded = 0;
  let failed = 0;
  let activitiesStored = 0;
  // Sequential on purpose: each ingest pulls the account's full activity history
  // from SnapTrade (rate-limited upstream). A background job has no latency budget.
  for (const ref of refs) {
    if (shouldSkipSnapTradeHistoryRefreshForPressure()) {
      break;
    }
    try {
      const result = await ingestSnapTradeAccountHistory({
        appUserId: ref.appUserId,
        accountId: ref.accountId,
      });
      succeeded += 1;
      activitiesStored += result.activitiesStored;
    } catch (error) {
      failed += 1;
      logger.warn(
        { err: error, accountId: ref.accountId },
        "SnapTrade history refresh failed for account",
      );
    }
  }
  return { accounts: refs.length, succeeded, failed, activitiesStored };
}

// Connect-time hook: refresh just this user's accounts (fire-and-forget from the
// sync route). Returns a no-op summary when SnapTrade is not configured.
export async function refreshSnapTradeAccountHistoryForUser(
  appUserId: string,
): Promise<SnapTradeHistoryRefreshSummary> {
  if (shouldSkipSnapTradeHistoryRefreshForPressure()) {
    return { accounts: 0, succeeded: 0, failed: 0, activitiesStored: 0 };
  }
  if (!snapTradeConfigured()) {
    return { accounts: 0, succeeded: 0, failed: 0, activitiesStored: 0 };
  }
  const refs = await listSnapTradeAccountsForRefresh(appUserId);
  return refreshAccounts(refs);
}

// Every connected SnapTrade account across all users.
export async function refreshAllSnapTradeAccountHistory(): Promise<SnapTradeHistoryRefreshSummary> {
  if (shouldSkipSnapTradeHistoryRefreshForPressure()) {
    return { accounts: 0, succeeded: 0, failed: 0, activitiesStored: 0 };
  }
  const refs = await listSnapTradeAccountsForRefresh();
  return refreshAccounts(refs);
}

// Read-time freshness hook. The /history read serves stored data immediately; this
// keeps it current WITHOUT blocking the response — a throttled, deduped, single-
// account background ingest. Throttling avoids a refresh storm when a user reloads
// the account tab repeatedly (each live pull is slow + rate-limited upstream).
const READ_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000; // per account, per process
const lastReadRefreshAt = new Map<string, number>();
const inFlightReadRefresh = new Set<string>();

export function refreshSnapTradeAccountHistoryOnRead(input: {
  appUserId: string;
  accountId: string;
  now?: number;
}): void {
  if (!snapTradeConfigured()) {
    return;
  }
  if (shouldSkipSnapTradeHistoryRefreshForPressure()) {
    return;
  }
  const key = input.accountId;
  if (inFlightReadRefresh.has(key)) {
    return;
  }
  const now = input.now ?? Date.now();
  if (now - (lastReadRefreshAt.get(key) ?? 0) < READ_REFRESH_MIN_INTERVAL_MS) {
    return;
  }
  lastReadRefreshAt.set(key, now);
  inFlightReadRefresh.add(key);
  void ingestSnapTradeAccountHistory({
    appUserId: input.appUserId,
    accountId: input.accountId,
  })
    .catch((error) =>
      logger.warn(
        { err: error, accountId: key },
        "SnapTrade read-time history refresh failed",
      ),
    )
    .finally(() => {
      inFlightReadRefresh.delete(key);
    });
}

export function startSnapTradeHistoryRefreshScheduler(): void {
  if (!snapTradeConfigured()) {
    logger.info(
      "SnapTrade env vars are not configured; SnapTrade history refresh disabled",
    );
    return;
  }

  const runOnce = (reason: string) =>
    refreshAllSnapTradeAccountHistory()
      .then((summary) =>
        logger.info({ ...summary, reason }, "SnapTrade history refresh complete"),
      )
      .catch((error) =>
        logger.warn({ err: error, reason }, "SnapTrade history refresh failed"),
      );

  setTimeout(() => {
    void runInDbLane("bulk", () => runOnce("scheduled-initial"));
  }, SNAPTRADE_HISTORY_INITIAL_DELAY_MS).unref?.();

  const timer = setInterval(() => {
    void runInDbLane("bulk", () => runOnce("scheduled"));
  }, SNAPTRADE_HISTORY_REFRESH_INTERVAL_MS);
  timer.unref?.();
}
