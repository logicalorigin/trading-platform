import { and, eq, isNotNull } from "drizzle-orm";

import { brokerAccountsTable, brokerConnectionsTable, db } from "@workspace/db";
import * as dbExports from "@workspace/db";
import { logger } from "../lib/logger";
import { ingestSnapTradeAccountHistory } from "./snaptrade-account-history";

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
  return Boolean(
    env["SNAPTRADE_CLIENTID"]?.trim() && env["SNAPTRADE_API_KEY"]?.trim(),
  );
}

type SnapTradeAccountRef = { accountId: string; appUserId: string };
type SnapTradeHistoryIngest = (
  ref: SnapTradeAccountRef,
) => Promise<{ activitiesStored: number }>;
type SnapTradeAccountRefreshOutcome =
  | {
      status: "succeeded";
      ref: SnapTradeAccountRef;
      activitiesStored: number;
    }
  | { status: "failed"; ref: SnapTradeAccountRef; error: unknown };
type SnapTradeHistoryRefreshBatch = {
  summary: SnapTradeHistoryRefreshSummary;
  outcomes: SnapTradeAccountRefreshOutcome[];
};

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

function summarizeRefreshOutcomes(
  outcomes: SnapTradeAccountRefreshOutcome[],
): SnapTradeHistoryRefreshSummary {
  return {
    accounts: outcomes.length,
    succeeded: outcomes.filter(({ status }) => status === "succeeded").length,
    failed: outcomes.filter(({ status }) => status === "failed").length,
    activitiesStored: outcomes.reduce(
      (sum, outcome) =>
        sum + (outcome.status === "succeeded" ? outcome.activitiesStored : 0),
      0,
    ),
  };
}

async function refreshAccounts(
  refs: SnapTradeAccountRef[],
  ingest: SnapTradeHistoryIngest = ingestSnapTradeAccountHistory,
): Promise<SnapTradeHistoryRefreshBatch> {
  const outcomes: SnapTradeAccountRefreshOutcome[] = [];
  // Sequential on purpose: each ingest pulls the account's full activity history
  // from SnapTrade (rate-limited upstream). A background job has no latency budget.
  for (const ref of refs) {
    try {
      const result = await ingest(ref);
      outcomes.push({
        status: "succeeded",
        ref,
        activitiesStored: result.activitiesStored,
      });
    } catch (error) {
      outcomes.push({ status: "failed", ref, error });
      logger.warn(
        { err: error, accountId: ref.accountId },
        "SnapTrade history refresh failed for account",
      );
    }
  }
  return { summary: summarizeRefreshOutcomes(outcomes), outcomes };
}

// Connect-time hook: refresh just this user's accounts (fire-and-forget from the
// sync route). Returns a no-op summary when SnapTrade is not configured.
export async function refreshSnapTradeAccountHistoryForUser(
  appUserId: string,
): Promise<SnapTradeHistoryRefreshSummary> {
  if (!snapTradeConfigured()) {
    return { accounts: 0, succeeded: 0, failed: 0, activitiesStored: 0 };
  }
  return runInDbLane("bulk", async () => {
    const refs = await listSnapTradeAccountsForRefresh(appUserId);
    return (await refreshAccounts(refs)).summary;
  });
}

// Every connected SnapTrade account across all users.
export async function refreshAllSnapTradeAccountHistory(): Promise<SnapTradeHistoryRefreshSummary> {
  return runInDbLane("bulk", async () => {
    const refs = await listSnapTradeAccountsForRefresh();
    return (await refreshAccounts(refs)).summary;
  });
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
  const refresh = runInDbLane("bulk", () =>
    ingestSnapTradeAccountHistory({
      appUserId: input.appUserId,
      accountId: input.accountId,
    }),
  );
  void refresh
    .catch((error) => {
      lastReadRefreshAt.delete(key);
      logger.warn(
        { err: error, accountId: key },
        "SnapTrade read-time history refresh failed",
      );
    })
    .finally(() => {
      inFlightReadRefresh.delete(key);
    });
}

export const __snapTradeHistorySchedulerInternalsForTests = {
  refreshAccounts,
};

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
