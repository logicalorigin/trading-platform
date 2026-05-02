import type { BrokerAccountSnapshot } from "../providers/ibkr/client";

const IBKR_INITIAL_MARGIN_FIELD = "InitMarginReq";
const IBKR_MAINTENANCE_MARGIN_FIELD = "MaintMarginReq";
const IBKR_MARGIN_USED_FALLBACK_FIELD =
  "MaintMarginReq (fallback; InitMarginReq missing)";

function accountNumber(value: unknown): number | null {
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

export function sumAccounts(
  accounts: BrokerAccountSnapshot[],
  key: keyof BrokerAccountSnapshot,
): number | null {
  const values = accounts
    .map((account) => accountNumber(account[key]))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function weightedAccountAverage(
  accounts: BrokerAccountSnapshot[],
  key: keyof BrokerAccountSnapshot,
): number | null {
  const weighted = accounts
    .map((account) => {
      const value = accountNumber(account[key]);
      const nav = accountNumber(account.netLiquidation);
      return value === null || nav === null ? null : { value, nav: Math.abs(nav) };
    })
    .filter((entry): entry is { value: number; nav: number } => Boolean(entry));
  const denominator = weighted.reduce((sum, entry) => sum + entry.nav, 0);
  if (!weighted.length || denominator <= 0) {
    return null;
  }
  return (
    weighted.reduce((sum, entry) => sum + entry.value * entry.nav, 0) /
    denominator
  );
}

export function buildAccountMarginSnapshot(accounts: BrokerAccountSnapshot[]) {
  const initialMargin = sumAccounts(accounts, "initialMargin");
  const maintenanceMargin = sumAccounts(accounts, "maintenanceMargin");
  const marginUsed = initialMargin ?? maintenanceMargin;
  const marginUsedUsesMaintenanceFallback =
    initialMargin === null && maintenanceMargin !== null;

  return {
    marginUsed,
    marginAvailable: sumAccounts(accounts, "excessLiquidity"),
    maintenanceMargin,
    maintenanceCushionPercent: weightedAccountAverage(accounts, "cushion"),
    dayTradingBuyingPower: sumAccounts(accounts, "dayTradingBuyingPower"),
    sma: sumAccounts(accounts, "sma"),
    regTInitialMargin: sumAccounts(accounts, "regTInitialMargin"),
    marginUsedUsesMaintenanceFallback,
    providerFields: {
      marginUsed: marginUsedUsesMaintenanceFallback
        ? IBKR_MARGIN_USED_FALLBACK_FIELD
        : IBKR_INITIAL_MARGIN_FIELD,
      marginUsedAuthoritative: IBKR_INITIAL_MARGIN_FIELD,
      marginUsedFallback: marginUsedUsesMaintenanceFallback
        ? IBKR_MAINTENANCE_MARGIN_FIELD
        : null,
      marginAvailable: "ExcessLiquidity",
      maintenanceMargin: IBKR_MAINTENANCE_MARGIN_FIELD,
      maintenanceCushionPercent: "Cushion",
      dayTradingBuyingPower: "DayTradingBuyingPower",
      sma: "SMA",
      regTInitialMargin: "RegTMargin",
    },
  };
}

export function inferAccountType(accountId: string): string {
  if (/du|paper/i.test(accountId)) {
    return "Paper";
  }
  if (/ira/i.test(accountId)) {
    return "IRA";
  }
  return "Margin";
}
