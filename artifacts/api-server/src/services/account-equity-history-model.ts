import type { RuntimeMode } from "../lib/runtime";
import type { BrokerAccountSnapshot } from "../providers/ibkr/client";
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
  source: "FLEX" | "LOCAL_LEDGER" | "SHADOW_LEDGER" | "IBKR_ACCOUNT_SUMMARY";
  deposits: number;
  withdrawals: number;
  dividends: number;
  fees: number;
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

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function externalTransferAmount(
  point: Pick<AccountEquityHistorySeedPoint, "deposits" | "withdrawals">,
): number {
  return (point.deposits ?? 0) - (point.withdrawals ?? 0);
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

export function calculateTransferAdjustedReturnPoints(
  seedPoints: AccountEquityHistorySeedPoint[],
) {
  const firstPoint = seedPoints[0] ?? null;
  const firstPointTransfer = firstPoint ? externalTransferAmount(firstPoint) : 0;
  const initialPreviousNav = firstPoint
    ? firstPointTransfer > 0
      ? Math.max(0, firstPoint.netLiquidation - firstPointTransfer)
      : firstPoint.netLiquidation - firstPointTransfer
    : null;
  const baseline =
    initialPreviousNav !== null && Math.abs(initialPreviousNav) > 0
      ? initialPreviousNav
      : (seedPoints.find((point) => Math.abs(point.netLiquidation) > 0)
          ?.netLiquidation ??
        firstPoint?.netLiquidation ??
        0);
  let previousNav: number | null = initialPreviousNav;
  let cumulativePnl = 0;
  let capitalBase = Math.max(
    Math.abs(baseline),
    Math.abs(firstPoint?.netLiquidation ?? 0),
  );

  return seedPoints.map((point, index) => {
    const transfer = externalTransferAmount(point);
    if (index > 0 && transfer > 0) {
      capitalBase += transfer;
    }
    const pnlDelta =
      previousNav === null ? 0 : point.netLiquidation - previousNav - transfer;
    cumulativePnl += pnlDelta;
    previousNav = point.netLiquidation;

    return {
      ...point,
      externalTransfer: transfer,
      pnlDelta,
      cumulativePnl,
      returnPercent: capitalBase ? (cumulativePnl / capitalBase) * 100 : 0,
    };
  });
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
  const bucketSizeMs = accountSnapshotBucketSizeMs(range);
  if (!bucketSizeMs || rows.length <= 1) {
    return rows;
  }

  const byBucket = new Map<string, EquitySnapshotRow>();
  const firstByDay = new Map<string, EquitySnapshotRow>();
  rows.forEach((row) => {
    const bucketStart = Math.floor(row.asOf.getTime() / bucketSizeMs);
    byBucket.set(`${row.providerAccountId}:${bucketStart}`, row);

    const dayKey = `${row.providerAccountId}:${formatDateOnly(row.asOf)}`;
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
    (row) => !flexTransferDates.has(formatDateOnly(row.asOf)),
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
