import type { RuntimeMode } from "../lib/runtime";
import { HttpError } from "../lib/errors";
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
    | "MIXED"
    | "LOCAL_LEDGER"
    | "SHADOW_LEDGER"
    | "IBKR_ACCOUNT_SUMMARY"
    | "SNAPTRADE_BALANCE_HISTORY";
  deposits: number;
  withdrawals: number;
  dividends: number;
  fees: number;
};

export type AccountEquityHistoryAccountPoint = {
  providerAccountId: string;
  point: AccountEquityHistorySeedPoint;
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

const requireSingleAggregateCurrency = (currencies: string[]) => {
  const normalized = new Set(
    currencies.map((currency) => currency.trim().toUpperCase()).filter(Boolean),
  );
  if (normalized.size > 1) {
    throw new HttpError(
      409,
      "Combined equity history is unavailable across currencies without authoritative FX rates.",
      {
        code: "account_currency_conversion_required",
        expose: true,
      },
    );
  }
};

type ExternalCashTransferCandidate = {
  activityType: string;
  description: string | null;
  amount: string | number;
};

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
  requireSingleAggregateCurrency(rows.map((row) => row.currency));
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

  const initialAccountIds = new Set(firstTimestampByAccount.keys());
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

    const accountRows = Array.from(latestByAccount.values());
    const netLiquidationValues = accountRows.map((accountRow) =>
      toHistoryNumber(accountRow.netLiquidation),
    );
    const cashValues = accountRows.map((accountRow) =>
      toHistoryNumber(accountRow.cash),
    );
    const buyingPowerValues = accountRows.map((accountRow) =>
      toHistoryNumber(accountRow.buyingPower),
    );
    const sumCompleteValues = (values: Array<number | null>): string | null =>
      values.some((value) => value === null)
        ? null
        : String(values.reduce<number>((sum, value) => sum + value!, 0));

    combinedRows.push({
      providerAccountId: "combined",
      asOf: row.asOf,
      currency: row.currency,
      netLiquidation: sumCompleteValues(netLiquidationValues),
      cash: sumCompleteValues(cashValues),
      buyingPower: sumCompleteValues(buyingPowerValues),
    });
  });

  return combinedRows;
}

const equitySeedPointSourceRank = (
  source: AccountEquityHistorySeedPoint["source"],
): number => {
  switch (source) {
    case "MIXED":
      return 5;
    case "IBKR_ACCOUNT_SUMMARY":
      return 4;
    case "FLEX":
      return 3;
    case "SNAPTRADE_BALANCE_HISTORY":
      return 2;
    case "SHADOW_LEDGER":
    case "LOCAL_LEDGER":
      return 1;
  }
};

export function aggregateCombinedEquitySeedPoints(
  rows: AccountEquityHistoryAccountPoint[],
  input: { expectedAccountIds?: string[] } = {},
): AccountEquityHistorySeedPoint[] {
  requireSingleAggregateCurrency(rows.map((row) => row.point.currency));
  const byAccountTimestamp = new Map<string, AccountEquityHistoryAccountPoint>();
  rows.forEach((row) => {
    const key = `${row.providerAccountId}:${row.point.timestamp.getTime()}`;
    const current = byAccountTimestamp.get(key);
    if (
      !current ||
      equitySeedPointSourceRank(row.point.source) >=
        equitySeedPointSourceRank(current.point.source)
    ) {
      byAccountTimestamp.set(key, row);
    }
  });
  const expectedAccountIds = new Set(
    (input.expectedAccountIds ?? [])
      .map((accountId) => accountId.trim())
      .filter(Boolean),
  );
  const sortedRows = Array.from(byAccountTimestamp.values())
    .filter(
      (row) =>
        !expectedAccountIds.size || expectedAccountIds.has(row.providerAccountId),
    )
    .sort(
    (left, right) =>
      left.point.timestamp.getTime() - right.point.timestamp.getTime(),
    );
  const firstTimestampByAccount = new Map<string, number>();
  sortedRows.forEach((row) => {
    if (!firstTimestampByAccount.has(row.providerAccountId)) {
      firstTimestampByAccount.set(
        row.providerAccountId,
        row.point.timestamp.getTime(),
      );
    }
  });
  if (!firstTimestampByAccount.size) {
    return [];
  }

  const initialAccountIds = expectedAccountIds.size
    ? expectedAccountIds
    : new Set(firstTimestampByAccount.keys());
  const latestByAccount = new Map<string, AccountEquityHistorySeedPoint>();
  const combinedPoints: AccountEquityHistorySeedPoint[] = [];

  for (let index = 0; index < sortedRows.length; ) {
    const timestampMs = sortedRows[index]!.point.timestamp.getTime();
    const timestampRows: AccountEquityHistoryAccountPoint[] = [];
    while (
      index < sortedRows.length &&
      sortedRows[index]!.point.timestamp.getTime() === timestampMs
    ) {
      timestampRows.push(sortedRows[index]!);
      index += 1;
    }
    timestampRows.forEach((row) => {
      latestByAccount.set(row.providerAccountId, row.point);
    });
    const initialAccountsReady = Array.from(initialAccountIds).every(
      (accountId) => latestByAccount.has(accountId),
    );
    if (!initialAccountsReady) {
      continue;
    }

    const sources = new Set(
      Array.from(initialAccountIds, (accountId) =>
        latestByAccount.get(accountId)!.source,
      ),
    );
    combinedPoints.push({
      timestamp: new Date(timestampMs),
      netLiquidation: Array.from(latestByAccount.values()).reduce(
        (sum, point) => sum + point.netLiquidation,
        0,
      ),
      currency:
        timestampRows.at(-1)?.point.currency ||
        latestByAccount.values().next().value?.currency ||
        "USD",
      source:
        sources.size === 1 ? sources.values().next().value! : "MIXED",
      deposits: timestampRows.reduce(
        (sum, row) => sum + row.point.deposits,
        0,
      ),
      withdrawals: timestampRows.reduce(
        (sum, row) => sum + row.point.withdrawals,
        0,
      ),
      dividends: timestampRows.reduce(
        (sum, row) => sum + row.point.dividends,
        0,
      ),
      fees: timestampRows.reduce((sum, row) => sum + row.point.fees, 0),
    });
  }

  return combinedPoints;
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
  flexTransferAccountDates: Set<string>,
): EquitySnapshotRow[] {
  if (!flexTransferAccountDates.size) {
    return rows;
  }
  return rows.filter(
    (row) =>
      !flexTransferAccountDates.has(
        `${row.providerAccountId}:${toIsoDateString(row.asOf)}`,
      ),
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
