import type { RuntimeMode } from "../lib/runtime";
import { toIsoDateString } from "../lib/values";
import type { BrokerAccountSnapshot } from "../providers/ibkr/client";
import { calculateTransferAdjustedReturnSeries } from "@workspace/account-math";
import { resolveNyseCalendarDay } from "@workspace/market-calendar";
import {
  accountSnapshotBucketSizeMs,
  type AccountRange,
} from "./account-ranges";
import { inferAccountType } from "./account-summary-model";

export type EquitySnapshotRow = {
  providerAccountId: string;
  asOf: Date;
  currency: string;
  netLiquidation: string | null;
  cash?: string | null;
  buyingPower?: string | null;
};

export type PersistedAccountSnapshotRow = EquitySnapshotRow & {
  displayName: string;
  mode: RuntimeMode;
  cash: string | null;
  buyingPower: string | null;
  maintenanceMargin: string | null;
};

export type AccountEquityHistorySeedPoint = {
  timestamp: Date;
  netLiquidation: number;
  currency: string;
  source:
    | "FLEX"
    | "LOCAL_LEDGER"
    | "SHADOW_LEDGER"
    | "IBKR_ACCOUNT_SUMMARY"
    | "SNAPTRADE_BALANCE_HISTORY";
  deposits: number;
  withdrawals: number;
  dividends: number;
  fees: number;
};

export type ActivityLedgerEquityEvent = {
  timestamp: Date;
  currency: string;
  deposits?: number;
  withdrawals?: number;
  realizedPnl?: number;
  dividends?: number;
  fees?: number;
};

type ExternalCashTransferCandidate = {
  activityType: string;
  description: string | null;
  amount: string | number;
};

const INITIAL_COMBINED_ACCOUNT_COHORT_WINDOW_MS = 5 * 60_000;

function toHistoryNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[$,%\s,]/g, "");
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isZeroHistoryNumber(value: unknown): boolean {
  const numeric = toHistoryNumber(value);
  return numeric !== null && Math.abs(numeric) === 0;
}

export function isPlaceholderZeroBalanceSnapshot(
  row: Pick<EquitySnapshotRow, "netLiquidation" | "cash" | "buyingPower">,
): boolean {
  return (
    isZeroHistoryNumber(row.netLiquidation) &&
    isZeroHistoryNumber(row.cash) &&
    isZeroHistoryNumber(row.buyingPower)
  );
}

export function isPlaceholderZeroAccountSnapshot(
  account: Pick<
    BrokerAccountSnapshot,
    "netLiquidation" | "cash" | "buyingPower"
  >,
): boolean {
  return (
    isZeroHistoryNumber(account.netLiquidation) &&
    isZeroHistoryNumber(account.cash) &&
    isZeroHistoryNumber(account.buyingPower)
  );
}

export function filterPlaceholderZeroEquitySnapshotRows(
  rows: EquitySnapshotRow[],
): EquitySnapshotRow[] {
  return rows.filter((row) => !isPlaceholderZeroBalanceSnapshot(row));
}

export function dedupeEquitySnapshotRows(
  rows: EquitySnapshotRow[],
): EquitySnapshotRow[] {
  const byAccountTimestamp = new Map<string, EquitySnapshotRow>();
  rows.forEach((row) => {
    byAccountTimestamp.set(
      `${row.providerAccountId}:${row.asOf.getTime()}`,
      row,
    );
  });

  return Array.from(byAccountTimestamp.values()).sort(
    (left, right) => left.asOf.getTime() - right.asOf.getTime(),
  );
}

export function aggregateCombinedEquitySnapshotRows(
  rows: EquitySnapshotRow[],
): EquitySnapshotRow[] {
  const sortedRows = rows
    .slice()
    .sort((left, right) => left.asOf.getTime() - right.asOf.getTime());
  const firstTimestampByAccount = new Map<string, number>();
  sortedRows.forEach((row) => {
    if (!firstTimestampByAccount.has(row.providerAccountId)) {
      firstTimestampByAccount.set(row.providerAccountId, row.asOf.getTime());
    }
  });
  if (firstTimestampByAccount.size <= 1) {
    return rows;
  }

  const firstTimestamp = Math.min(...firstTimestampByAccount.values());
  const initialAccountIds = new Set(
    Array.from(firstTimestampByAccount.entries())
      .filter(
        ([, timestamp]) =>
          timestamp - firstTimestamp <= INITIAL_COMBINED_ACCOUNT_COHORT_WINDOW_MS,
      )
      .map(([accountId]) => accountId),
  );
  const latestByAccount = new Map<string, EquitySnapshotRow>();
  const combinedRows: EquitySnapshotRow[] = [];
  sortedRows.forEach((row) => {
    latestByAccount.set(row.providerAccountId, row);
    const initialAccountsReady = Array.from(initialAccountIds).every((accountId) =>
      latestByAccount.has(accountId),
    );
    if (!initialAccountsReady) {
      return;
    }

    let netLiquidation = 0;
    let cash = 0;
    let buyingPower = 0;
    let hasCash = false;
    let hasBuyingPower = false;
    latestByAccount.forEach((accountRow) => {
      netLiquidation += toHistoryNumber(accountRow.netLiquidation) ?? 0;
      const accountCash = toHistoryNumber(accountRow.cash);
      if (accountCash !== null) {
        cash += accountCash;
        hasCash = true;
      }
      const accountBuyingPower = toHistoryNumber(accountRow.buyingPower);
      if (accountBuyingPower !== null) {
        buyingPower += accountBuyingPower;
        hasBuyingPower = true;
      }
    });

    combinedRows.push({
      providerAccountId: "combined",
      asOf: row.asOf,
      currency: row.currency,
      netLiquidation: String(netLiquidation),
      cash: hasCash ? String(cash) : null,
      buyingPower: hasBuyingPower ? String(buyingPower) : null,
    });
  });

  return combinedRows;
}

export function equitySnapshotBucketSizeMs(
  range: AccountRange,
  rows: EquitySnapshotRow[],
): number | null {
  const defaultBucketSizeMs = accountSnapshotBucketSizeMs(range);
  if (range !== "ALL" || rows.length <= 1) {
    return defaultBucketSizeMs;
  }

  const timestampsMs = rows
    .map((row) => row.asOf.getTime())
    .filter((timestampMs) => Number.isFinite(timestampMs));
  if (timestampsMs.length <= 1) {
    return defaultBucketSizeMs;
  }

  const spanMs = Math.max(...timestampsMs) - Math.min(...timestampsMs);
  if (spanMs <= 31 * 24 * 60 * 60_000) {
    return 5 * 60_000;
  }
  if (spanMs <= 120 * 24 * 60 * 60_000) {
    return 30 * 60_000;
  }
  if (spanMs <= 370 * 24 * 60 * 60_000) {
    return 2 * 60 * 60_000;
  }
  return defaultBucketSizeMs;
}

export function calculateTransferAdjustedReturnPoints(
  seedPoints: AccountEquityHistorySeedPoint[],
) {
  const adjusted = calculateTransferAdjustedReturnSeries(seedPoints);
  return seedPoints.map((point, index) => ({
    ...point,
    externalTransfer: adjusted[index]?.externalTransfer ?? 0,
    pnlDelta: adjusted[index]?.pnlDelta ?? 0,
    cumulativePnl: adjusted[index]?.cumulativePnl ?? 0,
    returnPercent: adjusted[index]?.returnPercent ?? 0,
  }));
}

function marketDateKey(value: Date): string | null {
  return resolveNyseCalendarDay(value)?.date ?? null;
}

function addCalendarDaysToMarketDateKey(value: string, days: number): string {
  const next = new Date(`${value}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function equityPointTimestampForMarketDate(value: string): Date {
  const closeAt = resolveNyseCalendarDay(`${value}T12:00:00.000Z`)?.regularCloseAt;
  const close = closeAt ? new Date(closeAt) : null;
  if (close && Number.isFinite(close.getTime())) {
    return close;
  }
  return new Date(`${value}T17:00:00.000Z`);
}

function roundHistoryMoney(value: number): number {
  return Number(value.toFixed(6));
}

export function reconstructEquityHistoryFromActivityLedger(input: {
  events: ActivityLedgerEquityEvent[];
  terminal: {
    timestamp: Date;
    netLiquidation: number;
    currency: string;
  } | null;
  source: AccountEquityHistorySeedPoint["source"];
}): AccountEquityHistorySeedPoint[] {
  if (!input.terminal || !Number.isFinite(input.terminal.netLiquidation)) {
    return [];
  }

  const sortedEvents = input.events
    .filter((event) => Number.isFinite(event.timestamp.getTime()))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  if (!sortedEvents.length) {
    return [
      {
        timestamp: input.terminal.timestamp,
        netLiquidation: input.terminal.netLiquidation,
        currency: input.terminal.currency,
        source: input.source,
        deposits: 0,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
      },
    ];
  }

  const firstDay = marketDateKey(sortedEvents[0]!.timestamp);
  const terminalDay = marketDateKey(input.terminal.timestamp);
  if (!firstDay || !terminalDay || firstDay > terminalDay) {
    return [];
  }

  const eventsByDay = new Map<
    string,
    Required<Omit<ActivityLedgerEquityEvent, "timestamp" | "currency">> & {
      currency: string;
    }
  >();
  for (const event of sortedEvents) {
    const key = marketDateKey(event.timestamp);
    if (!key || key > terminalDay) {
      continue;
    }
    const current = eventsByDay.get(key) ?? {
      currency: event.currency || input.terminal.currency,
      deposits: 0,
      withdrawals: 0,
      realizedPnl: 0,
      dividends: 0,
      fees: 0,
    };
    current.deposits += event.deposits ?? 0;
    current.withdrawals += event.withdrawals ?? 0;
    current.realizedPnl += event.realizedPnl ?? 0;
    current.dividends += event.dividends ?? 0;
    current.fees += event.fees ?? 0;
    eventsByDay.set(key, current);
  }

  let cumulativeLedgerDelta = 0;
  const cumulativeByDay = new Map<string, number>();
  for (
    let day = firstDay;
    day <= terminalDay;
    day = addCalendarDaysToMarketDateKey(day, 1)
  ) {
    const key = day;
    const event = eventsByDay.get(key);
    if (event) {
      cumulativeLedgerDelta +=
        event.deposits -
        event.withdrawals +
        event.realizedPnl +
        event.dividends -
        event.fees;
    }
    cumulativeByDay.set(key, cumulativeLedgerDelta);
  }

  const terminalKey = terminalDay;
  const terminalLedgerDelta = cumulativeByDay.get(terminalKey) ?? 0;
  const openingAnchor = input.terminal.netLiquidation - terminalLedgerDelta;
  const points: AccountEquityHistorySeedPoint[] = [];
  const outputStartDay =
    Math.abs(openingAnchor) > 0.000001
      ? addCalendarDaysToMarketDateKey(firstDay, -1)
      : firstDay;
  for (
    let day = outputStartDay;
    day <= terminalDay;
    day = addCalendarDaysToMarketDateKey(day, 1)
  ) {
    const key = day;
    const event = eventsByDay.get(key);
    points.push({
      timestamp:
        key === terminalKey
          ? input.terminal.timestamp
          : equityPointTimestampForMarketDate(key),
      netLiquidation: roundHistoryMoney(
        openingAnchor + (cumulativeByDay.get(key) ?? 0),
      ),
      currency: event?.currency || input.terminal.currency,
      source: input.source,
      deposits: roundHistoryMoney(event?.deposits ?? 0),
      withdrawals: roundHistoryMoney(event?.withdrawals ?? 0),
      dividends: roundHistoryMoney(event?.dividends ?? 0),
      fees: roundHistoryMoney(event?.fees ?? 0),
    });
  }
  return points;
}

export function classifyExternalCashTransfer(
  row: ExternalCashTransferCandidate,
): number | null {
  const amount = toHistoryNumber(row.amount);
  if (amount === null || amount === 0) {
    return null;
  }

  const activityType = row.activityType ?? "";
  const description = row.description ?? "";
  const text = `${activityType} ${description}`;
  if (/dividend|interest|commission|fee|tax|withholding/i.test(text)) {
    return null;
  }
  if (
    !/deposit|withdraw|disbursement|cash receipt|electronic fund|funds transfer|wire|ach|incoming|outgoing/i.test(
      text,
    )
  ) {
    return null;
  }

  if (/withdraw|disbursement|outgoing/i.test(description)) {
    return -Math.abs(amount);
  }
  if (/deposit|cash receipt|incoming/i.test(description)) {
    return Math.abs(amount);
  }
  if (/withdraw|outgoing/i.test(activityType)) {
    return -Math.abs(amount);
  }
  if (/deposit|incoming/i.test(activityType)) {
    return Math.abs(amount);
  }
  return amount;
}

export function compactEquitySnapshotRows(
  rows: EquitySnapshotRow[],
  range: AccountRange,
): EquitySnapshotRow[] {
  const bucketSizeMs = equitySnapshotBucketSizeMs(range, rows);
  if (!bucketSizeMs || rows.length <= 1) {
    return rows;
  }

  const byBucket = new Map<string, EquitySnapshotRow>();
  const firstByDay = new Map<string, EquitySnapshotRow>();
  rows.forEach((row) => {
    const bucketStart = Math.floor(row.asOf.getTime() / bucketSizeMs);
    byBucket.set(`${row.providerAccountId}:${bucketStart}`, row);

    const dayKey = `${row.providerAccountId}:${toIsoDateString(row.asOf)}`;
    const currentFirst = firstByDay.get(dayKey);
    if (!currentFirst || row.asOf.getTime() < currentFirst.asOf.getTime()) {
      firstByDay.set(dayKey, row);
    }
  });

  const byAccountTimestamp = new Map<string, EquitySnapshotRow>();
  const addRow = (row: EquitySnapshotRow) => {
    byAccountTimestamp.set(`${row.providerAccountId}:${row.asOf.getTime()}`, row);
  };
  byBucket.forEach(addRow);
  firstByDay.forEach(addRow);

  return Array.from(byAccountTimestamp.values()).sort(
    (left, right) => left.asOf.getTime() - right.asOf.getTime(),
  );
}

export function filterSnapshotsOnFlexTransferDates(
  rows: EquitySnapshotRow[],
  flexTransferDates: Set<string>,
): EquitySnapshotRow[] {
  if (!flexTransferDates.size) {
    return rows;
  }
  return rows.filter(
    (row) => !flexTransferDates.has(toIsoDateString(row.asOf)),
  );
}

function hasMeaningfulEquityHistory(point: AccountEquityHistorySeedPoint): boolean {
  return (
    Math.abs(point.netLiquidation) > 0 ||
    Math.abs(point.deposits) > 0 ||
    Math.abs(point.withdrawals) > 0 ||
    Math.abs(point.dividends) > 0 ||
    Math.abs(point.fees) > 0
  );
}

export function trimLeadingInactiveEquityPoints(
  points: AccountEquityHistorySeedPoint[],
): AccountEquityHistorySeedPoint[] {
  const firstMeaningfulIndex = points.findIndex(hasMeaningfulEquityHistory);
  if (firstMeaningfulIndex <= 0) {
    return points;
  }
  return points.slice(firstMeaningfulIndex);
}

export function persistedAccountRowsToSnapshots(
  rows: PersistedAccountSnapshotRow[],
): {
  accounts: BrokerAccountSnapshot[];
  latestSnapshotAt: Date | null;
} {
  const latestByAccount = new Map<string, PersistedAccountSnapshotRow>();
  rows.forEach((row) => {
    if (!latestByAccount.has(row.providerAccountId)) {
      latestByAccount.set(row.providerAccountId, row);
    }
  });

  const accounts = Array.from(latestByAccount.values()).map((row) => ({
    id: row.providerAccountId,
    providerAccountId: row.providerAccountId,
    provider: "ibkr" as const,
    mode: row.mode,
    displayName: row.displayName || `IBKR ${row.providerAccountId}`,
    currency: row.currency || "USD",
    buyingPower: toHistoryNumber(row.buyingPower) ?? 0,
    cash: toHistoryNumber(row.cash) ?? 0,
    netLiquidation: toHistoryNumber(row.netLiquidation) ?? 0,
    accountType: inferAccountType(row.providerAccountId),
    totalCashValue: null,
    settledCash: null,
    accruedCash: null,
    initialMargin: null,
    maintenanceMargin: toHistoryNumber(row.maintenanceMargin),
    excessLiquidity: null,
    cushion: null,
    sma: null,
    dayTradingBuyingPower: null,
    regTInitialMargin: null,
    grossPositionValue: null,
    leverage: null,
    dayTradesRemaining: null,
    isPatternDayTrader: null,
    updatedAt: row.asOf,
  }));

  const latestSnapshotAt = accounts.length
    ? new Date(
        Math.max(...accounts.map((account) => account.updatedAt.getTime())),
      )
    : null;

  return { accounts, latestSnapshotAt };
}
