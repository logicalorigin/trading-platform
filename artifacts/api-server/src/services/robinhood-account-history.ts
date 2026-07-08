import { createHash } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  robinhoodAccountActivitiesTable,
  type RobinhoodAccountActivity,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { RobinhoodMcpSession } from "../providers/robinhood/mcp-client";
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
};

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

  return {
    accountId: account.id,
    tradesFetched: trades.length,
    activitiesStored,
  };
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
