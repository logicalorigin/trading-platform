import { and, eq, isNotNull } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import * as dbExports from "@workspace/db";
import { logger } from "../lib/logger";
import { ingestRobinhoodAccountHistory } from "./robinhood-account-history";

// Proactive Robinhood P&L backfill. ingestRobinhoodAccountHistory pulls an
// account's realized-P&L trade history from the Robinhood MCP and persists it,
// but on its own that only happens on connect or when the account page is opened.
// This worker refreshes every connected Robinhood account on a schedule so past
// P&L populates automatically and stays fresh without any page open. Mirrors
// startSnapTradeHistoryRefreshScheduler / startAccountFlexRefreshScheduler.
//
// There is no single "Robinhood configured" env (OAuth uses dynamic client
// registration), so the gate is data-driven: with no connected Robinhood
// accounts this is a no-op, and a per-account "not connected" error is caught
// and skipped.

const ROBINHOOD_HISTORY_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h
// Stagger past the connect herd + other DB-touching workers that start at boot.
const ROBINHOOD_HISTORY_INITIAL_DELAY_MS = 50_000;
type DbLaneRunner = <T>(lane: "bulk", fn: () => T) => T;
const runInDbLane = (
  dbExports as typeof dbExports & { runInDbLane: DbLaneRunner }
).runInDbLane;

type RobinhoodAccountRef = { accountId: string; appUserId: string };

export type RobinhoodHistoryRefreshSummary = {
  accounts: number;
  succeeded: number;
  failed: number;
  activitiesStored: number;
};

async function listRobinhoodAccountsForRefresh(
  appUserId?: string,
): Promise<RobinhoodAccountRef[]> {
  const filters = [
    eq(brokerConnectionsTable.brokerProvider, "robinhood"),
    eq(brokerAccountsTable.mode, "live"),
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
    (row): row is RobinhoodAccountRef => typeof row.appUserId === "string",
  );
}

async function refreshAccounts(
  refs: RobinhoodAccountRef[],
): Promise<RobinhoodHistoryRefreshSummary> {
  let succeeded = 0;
  let failed = 0;
  let activitiesStored = 0;
  // Sequential on purpose: each ingest pages the account's full P&L history from
  // the Robinhood MCP (rate-limited upstream). A background job has no latency
  // budget.
  for (const ref of refs) {
    try {
      const result = await ingestRobinhoodAccountHistory({
        appUserId: ref.appUserId,
        accountId: ref.accountId,
      });
      succeeded += 1;
      activitiesStored += result.activitiesStored;
    } catch (error) {
      failed += 1;
      logger.warn(
        { err: error, accountId: ref.accountId },
        "Robinhood history refresh failed for account",
      );
    }
  }
  return { accounts: refs.length, succeeded, failed, activitiesStored };
}

// Connect-time hook: refresh just this user's accounts (fire-and-forget from the
// sync route). No-op when the user has no connected Robinhood accounts.
export async function refreshRobinhoodAccountHistoryForUser(
  appUserId: string,
): Promise<RobinhoodHistoryRefreshSummary> {
  const refs = await listRobinhoodAccountsForRefresh(appUserId);
  return refreshAccounts(refs);
}

// Every connected Robinhood account across all users.
export async function refreshAllRobinhoodAccountHistory(): Promise<RobinhoodHistoryRefreshSummary> {
  const refs = await listRobinhoodAccountsForRefresh();
  return refreshAccounts(refs);
}

// Read-time freshness hook. The account detail read serves stored data
// immediately; this keeps it current WITHOUT blocking the response — a throttled,
// deduped, single-account background ingest. Throttling avoids a refresh storm
// when a user reloads the account tab repeatedly.
const READ_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000; // per account, per process
const lastReadRefreshAt = new Map<string, number>();
const inFlightReadRefresh = new Set<string>();

export function refreshRobinhoodAccountHistoryOnRead(input: {
  appUserId: string;
  accountId: string;
  now?: number;
}): void {
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
  void ingestRobinhoodAccountHistory({
    appUserId: input.appUserId,
    accountId: input.accountId,
  })
    .catch((error) =>
      logger.warn(
        { err: error, accountId: key },
        "Robinhood read-time history refresh failed",
      ),
    )
    .finally(() => {
      inFlightReadRefresh.delete(key);
    });
}

export function startRobinhoodHistoryRefreshScheduler(): void {
  const runOnce = (reason: string) =>
    refreshAllRobinhoodAccountHistory()
      .then((summary) =>
        logger.info(
          { ...summary, reason },
          "Robinhood history refresh complete",
        ),
      )
      .catch((error) =>
        logger.warn({ err: error, reason }, "Robinhood history refresh failed"),
      );

  setTimeout(() => {
    void runInDbLane("bulk", () => runOnce("scheduled-initial"));
  }, ROBINHOOD_HISTORY_INITIAL_DELAY_MS).unref?.();

  const timer = setInterval(() => {
    void runInDbLane("bulk", () => runOnce("scheduled"));
  }, ROBINHOOD_HISTORY_REFRESH_INTERVAL_MS);
  timer.unref?.();
}
