import { createHash } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  balanceSnapshotsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  robinhoodAccountActivitiesTable,
  type RobinhoodAccountActivity,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { RobinhoodMcpSession } from "../providers/robinhood/mcp-client";
import {
  calculateTransferAdjustedReturnPoints,
  reconstructEquityHistoryFromActivityLedger,
} from "./account-equity-history-model";
import { getRobinhoodAccessToken } from "./robinhood-oauth";

// Backfills Robinhood per-trade realized P&L into robinhood_account_activities via
// the MCP `get_pnl_trade_history` tool. Robinhood returns realized P&L already
// computed per closing trade, so — unlike SnapTrade — no cost-basis lot matching
// is needed here; we store the rows verbatim. Mirrors snaptrade-account-history +
// snaptrade-history-scheduler so P&L populates without a page open.

const LOCAL_ID_PREFIX = "robinhood:";

// get_pnl_trade_history offers preset spans only (no arbitrary range). "all" is
// the widest and is what a backfill wants.
const BACKFILL_SPAN = "all";

// Safety bound: stop paging after this many pages even if the server keeps
// returning a cursor (defends against a pathological/looping cursor).
const MAX_PAGES = 200;

export type RobinhoodPnlTrade = {
  timestamp: string;
  symbol: string | null;
  side: string | null;
  quantity: string | null;
  price: string | null;
  realized_gain: string | null;
};

// Minimal seam the session must satisfy — lets tests inject a fake without a
// live MCP endpoint. The real RobinhoodMcpSession is structurally compatible.
export type RobinhoodHistorySession = {
  callTool(call: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
};

export type IngestRobinhoodAccountHistoryOptions = {
  appUserId: string;
  accountId: string;
  encryptionKey?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  now?: Date;
  // Test seam: supply a session directly instead of loading OAuth creds.
  session?: RobinhoodHistorySession;
};

export type IngestRobinhoodAccountHistoryResult = {
  accountId: string;
  tradesFetched: number;
  activitiesStored: number;
  balanceSnapshotStored: boolean;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Extract current net-liquidation from the get_portfolio payload
// ({ data: { total_value, cash, buying_power: { buying_power } } }). Mirrors the
// account-list balance reader; Robinhood exposes no historical balance endpoint,
// so snapshotting the current value each backfill run builds a forward equity
// curve (same fallback strategy as the SnapTrade backfill).
function portfolioNetLiquidation(payload: unknown): number | null {
  const root = asRecord(payload);
  const data = asRecord(root["data"]);
  const totalValue = toNumber(data["total_value"]);
  if (totalValue != null) return totalValue;
  return toNumber(data["cash"]);
}

type LocalRobinhoodAccount = {
  id: string;
  accountNumber: string;
  baseCurrency: string;
};

function accountNumberFromProviderAccountId(
  providerAccountId: string,
): string | null {
  if (!providerAccountId.startsWith(LOCAL_ID_PREFIX)) {
    return null;
  }
  const raw = providerAccountId.slice(LOCAL_ID_PREFIX.length).trim();
  return raw.length ? raw : null;
}

async function loadLocalRobinhoodAccount(
  appUserId: string,
  accountId: string,
): Promise<LocalRobinhoodAccount> {
  const [row] = await db
    .select({
      id: brokerAccountsTable.id,
      providerAccountId: brokerAccountsTable.providerAccountId,
      baseCurrency: brokerAccountsTable.baseCurrency,
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
        eq(brokerConnectionsTable.brokerProvider, "robinhood"),
        eq(brokerAccountsTable.mode, "live"),
      ),
    )
    .limit(1);

  const accountNumber = row
    ? accountNumberFromProviderAccountId(row.providerAccountId)
    : null;
  if (!row || !accountNumber) {
    throw new HttpError(404, "Robinhood account was not found", {
      code: "robinhood_account_not_found",
    });
  }
  return { id: row.id, accountNumber, baseCurrency: row.baseCurrency };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length ? value : null;
}

// The MCP client unwraps to structuredContent; get_pnl_trade_history returns
// { data: { account_number, span, trades[], next_cursor } } — but some transports
// hand back the inner { account_number, span, trades, next_cursor } directly, so
// accept either.
function unwrapPnlPage(payload: unknown): {
  trades: RobinhoodPnlTrade[];
  nextCursor: string | null;
} {
  const top = asRecord(payload);
  const body = "trades" in top ? top : asRecord(top["data"]);
  const rawTrades = Array.isArray(body["trades"]) ? body["trades"] : [];
  const trades = rawTrades.map((row): RobinhoodPnlTrade => {
    const r = asRecord(row);
    return {
      timestamp: readString(r, "timestamp") ?? "",
      symbol: readString(r, "symbol"),
      side: readString(r, "side"),
      quantity: readString(r, "quantity"),
      price: readString(r, "price"),
      realized_gain: readString(r, "realized_gain"),
    };
  });
  const nextCursor = readString(body, "next_cursor");
  return { trades, nextCursor };
}

// Robinhood P&L trades carry no stable server id, so derive a deterministic key
// from the row's identity fields for idempotent upserts.
function activityKey(accountNumber: string, trade: RobinhoodPnlTrade): string {
  const identity = [
    accountNumber,
    trade.timestamp,
    trade.symbol ?? "",
    trade.side ?? "",
    trade.quantity ?? "",
    trade.price ?? "",
    trade.realized_gain ?? "",
  ].join("|");
  return createHash("sha256").update(identity).digest("hex").slice(0, 64);
}

async function fetchAllPnlTrades(
  session: RobinhoodHistorySession,
  accountNumber: string,
): Promise<RobinhoodPnlTrade[]> {
  const trades: RobinhoodPnlTrade[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const args: Record<string, unknown> = {
      account_number: accountNumber,
      span: BACKFILL_SPAN,
    };
    if (cursor) {
      args["cursor"] = cursor;
    }
    const payload = await session.callTool({
      name: "get_pnl_trade_history",
      arguments: args,
    });
    const { trades: pageTrades, nextCursor } = unwrapPnlPage(payload);
    trades.push(...pageTrades.filter((t) => t.timestamp));
    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }
  return trades;
}

async function storeActivities(
  accountId: string,
  accountNumber: string,
  currency: string,
  trades: RobinhoodPnlTrade[],
  now: Date,
): Promise<number> {
  if (!trades.length) {
    return 0;
  }
  // Dedup within the batch (a cursor overlap could resend a row); the DB unique
  // index is the durable guard.
  const byKey = new Map<string, RobinhoodPnlTrade>();
  for (const trade of trades) {
    byKey.set(activityKey(accountNumber, trade), trade);
  }
  const rows = [...byKey.entries()].map(([key, trade]) => ({
    accountId,
    activityKey: key,
    closedAt: new Date(trade.timestamp),
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    price: trade.price,
    realizedGain: trade.realized_gain,
    currency,
    rawPayload: trade as unknown as Record<string, unknown>,
    updatedAt: now,
  }));
  await db
    .insert(robinhoodAccountActivitiesTable)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        robinhoodAccountActivitiesTable.accountId,
        robinhoodAccountActivitiesTable.activityKey,
      ],
      set: {
        closedAt: sql`excluded.closed_at`,
        symbol: sql`excluded.symbol`,
        side: sql`excluded.side`,
        quantity: sql`excluded.quantity`,
        price: sql`excluded.price`,
        realizedGain: sql`excluded.realized_gain`,
        currency: sql`excluded.currency`,
        rawPayload: sql`excluded.raw_payload`,
        updatedAt: now,
      },
    });
  return rows.length;
}

export async function ingestRobinhoodAccountHistory(
  options: IngestRobinhoodAccountHistoryOptions,
): Promise<IngestRobinhoodAccountHistoryResult> {
  const now = options.now ?? new Date();
  const account = await loadLocalRobinhoodAccount(
    options.appUserId,
    options.accountId,
  );

  let session = options.session;
  if (!session) {
    const accessToken = await getRobinhoodAccessToken({
      appUserId: options.appUserId,
      env: options.env,
      now,
      encryptionKey: options.encryptionKey,
    });
    session = new RobinhoodMcpSession({ accessToken });
  }

  const trades = await fetchAllPnlTrades(session, account.accountNumber);
  const activitiesStored = await storeActivities(
    account.id,
    account.accountNumber,
    account.baseCurrency,
    trades,
    now,
  );
  const balanceSnapshotStored = await snapshotCurrentBalance(
    session,
    account,
    now,
  );

  return {
    accountId: account.id,
    tradesFetched: trades.length,
    activitiesStored,
    balanceSnapshotStored,
  };
}

// Best-effort: snapshot the account's current net-liquidation so a forward
// equity curve accumulates (Robinhood has no historical balance endpoint).
// Never breaks the backfill — a balance failure just skips the snapshot.
async function snapshotCurrentBalance(
  session: RobinhoodHistorySession,
  account: LocalRobinhoodAccount,
  now: Date,
): Promise<boolean> {
  try {
    const payload = await session.callTool({
      name: "get_portfolio",
      arguments: { account_number: account.accountNumber },
    });
    const nlv = portfolioNetLiquidation(payload);
    if (nlv == null) {
      return false;
    }
    await db.insert(balanceSnapshotsTable).values({
      accountId: account.id,
      currency: account.baseCurrency,
      cash: "0.000000",
      buyingPower: "0.000000",
      netLiquidation: nlv.toFixed(6),
      maintenanceMargin: null,
      asOf: now,
    });
    return true;
  } catch (error) {
    logger.warn(
      { err: error, accountId: account.id },
      "Robinhood balance snapshot failed",
    );
    return false;
  }
}

// Stored-first read for the account-detail P&L surface. Never triggers a live
// pull (the scheduler + on-connect hook keep it fresh); serves sub-second.
export async function readRobinhoodAccountActivities(
  accountId: string,
): Promise<RobinhoodAccountActivity[]> {
  return db
    .select()
    .from(robinhoodAccountActivitiesTable)
    .where(eq(robinhoodAccountActivitiesTable.accountId, accountId))
    .orderBy(desc(robinhoodAccountActivitiesTable.closedAt));
}

export async function readRobinhoodActivityLedgerEquityHistory(
  accountId: string,
) {
  const [activities, snapshots] = await Promise.all([
    db
      .select()
      .from(robinhoodAccountActivitiesTable)
      .where(eq(robinhoodAccountActivitiesTable.accountId, accountId))
      .orderBy(asc(robinhoodAccountActivitiesTable.closedAt)),
    db
      .select({
        asOf: balanceSnapshotsTable.asOf,
        netLiquidation: balanceSnapshotsTable.netLiquidation,
        currency: balanceSnapshotsTable.currency,
      })
      .from(balanceSnapshotsTable)
      .where(eq(balanceSnapshotsTable.accountId, accountId))
      .orderBy(asc(balanceSnapshotsTable.asOf)),
  ]);
  const terminal = snapshots.reduce<{
    timestamp: Date;
    netLiquidation: number;
    currency: string;
  } | null>((latest, snapshot) => {
    const netLiquidation = toNumber(snapshot.netLiquidation);
    if (netLiquidation == null) {
      return latest;
    }
    if (!latest || snapshot.asOf.getTime() > latest.timestamp.getTime()) {
      return {
        timestamp: snapshot.asOf,
        netLiquidation,
        currency: snapshot.currency,
      };
    }
    return latest;
  }, null);

  // Robinhood exposes per-closing-trade realized_gain but no historical balance
  // API. Like the SnapTrade fallback, this is a realized-P&L anchored curve, not
  // true historical mark-to-market for open positions.
  const seedPoints = reconstructEquityHistoryFromActivityLedger({
    terminal,
    source: "LOCAL_LEDGER",
    events: activities
      .map((activity) => {
        const realizedPnl = toNumber(activity.realizedGain);
        if (realizedPnl == null) {
          return null;
        }
        return {
          timestamp: activity.closedAt,
          currency: activity.currency,
          realizedPnl,
        };
      })
      .filter((event): event is NonNullable<typeof event> => Boolean(event)),
  });
  return calculateTransferAdjustedReturnPoints(seedPoints);
}
