import type {
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
} from "../providers/ibkr/client";
import { toIsoDateString } from "../lib/values";
import {
  accountPositionTypeDisplayLabel,
  classifyAccountPositionType,
  isStaticAccountEtfSymbol,
} from "./account-position-type";

export type OrderTab = "working" | "history";

export type AccountPositionSource =
  | "IBKR_POSITIONS"
  | "SNAPTRADE_POSITIONS"
  | "ROBINHOOD_POSITIONS"
  | "SCHWAB_POSITIONS"
  | "BROKER_POSITIONS"
  | "MIXED_BROKER_POSITIONS";

export function accountPositionSourceForProvider(
  provider: string | null | undefined,
): AccountPositionSource {
  switch (provider?.trim().toLowerCase()) {
    case "ibkr":
      return "IBKR_POSITIONS";
    case "snaptrade":
      return "SNAPTRADE_POSITIONS";
    case "robinhood":
      return "ROBINHOOD_POSITIONS";
    case "schwab":
      return "SCHWAB_POSITIONS";
    default:
      return "BROKER_POSITIONS";
  }
}

export function combineAccountPositionSources(
  sources: Iterable<AccountPositionSource>,
): AccountPositionSource {
  const unique = new Set(sources);
  if (unique.size === 0) return "BROKER_POSITIONS";
  if (unique.size === 1) return unique.values().next().value!;
  return "MIXED_BROKER_POSITIONS";
}

function normalizedCurrency(value: unknown): string | null {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2,16}$/u.test(currency) ? currency : null;
}

export function accountTradeCurrenciesMatch(
  trades: Array<{ currency?: string | null }>,
  declaredCurrency: string,
): boolean {
  const declared = normalizedCurrency(declaredCurrency);
  return Boolean(
    declared &&
      trades.every((trade) => normalizedCurrency(trade.currency) === declared),
  );
}

const accountAnalysisDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function accountAnalysisMarketDateKey(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    accountAnalysisDateFormatter
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function optionExpirationDateKey(value: Date | string): string | null {
  if (value instanceof Date && Number.isNaN(value.getTime())) return null;
  const raw = value instanceof Date ? value.toISOString() : value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function accountOptionCalendarDte(
  expirationDate: Date | string,
  activityDate: Date | string,
): number | null {
  const difference = accountOptionCalendarDayDifference(
    expirationDate,
    activityDate,
  );
  return difference == null ? null : Math.max(0, difference);
}

export function accountOptionCalendarDayDifference(
  expirationDate: Date | string,
  activityDate: Date | string,
): number | null {
  const expirationKey = optionExpirationDateKey(expirationDate);
  const activityKey = accountAnalysisMarketDateKey(activityDate);
  if (!expirationKey || !activityKey) return null;
  const expirationDay = Date.parse(`${expirationKey}T00:00:00.000Z`);
  const activityDay = Date.parse(`${activityKey}T00:00:00.000Z`);
  return (expirationDay - activityDay) / 86_400_000;
}

export function summarizeAccountClosedTrades(
  trades: Array<{ realizedPnl?: number | null; commissions?: number | null }>,
) {
  const outcomes = trades.filter(
    (trade) =>
      typeof trade.realizedPnl === "number" && Number.isFinite(trade.realizedPnl),
  );
  const fees = trades.filter(
    (trade) =>
      typeof trade.commissions === "number" && Number.isFinite(trade.commissions),
  );
  return {
    count: trades.length,
    outcomeCount: outcomes.length,
    feeCount: fees.length,
    winners: outcomes.filter((trade) => trade.realizedPnl! > 0).length,
    losers: outcomes.filter((trade) => trade.realizedPnl! < 0).length,
    realizedPnl: trades.length > 0 && outcomes.length === trades.length
      ? outcomes.reduce((sum, trade) => sum + trade.realizedPnl!, 0)
      : null,
    commissions:
      trades.length > 0 && fees.length === trades.length
        ? fees.reduce((sum, trade) => sum + trade.commissions!, 0)
        : null,
  };
}

export function isEtfSymbol(symbol: string): boolean {
  return isStaticAccountEtfSymbol(symbol);
}

export function normalizeOrderTab(raw: unknown): OrderTab {
  return raw === "history" ? "history" : "working";
}

export function terminalOrderStatus(
  status: BrokerOrderSnapshot["status"],
): boolean {
  return (
    status === "filled" ||
    status === "canceled" ||
    status === "rejected" ||
    status === "expired"
  );
}

export function workingOrderStatus(
  status: BrokerOrderSnapshot["status"],
): boolean {
  return !terminalOrderStatus(status);
}

export function normalizeAssetClassLabel(
  position: BrokerPositionSnapshot,
): string {
  return accountPositionTypeDisplayLabel(classifyAccountPositionType(position));
}

export function normalizeTradeAssetClassLabel(input: {
  assetClass: string | null | undefined;
  symbol: string;
  positionType?: string | null;
  optionContract?: unknown;
}): string {
  const normalized = (input.assetClass ?? "").trim().toLowerCase();
  const compactSymbol = input.symbol.replace(/\s+/g, "").toUpperCase();
  if (
    input.optionContract ||
    normalized.includes("option") ||
    normalized === "opt" ||
    /^[A-Z0-9.]+\d{6}[CP]\d{8}$/.test(compactSymbol)
  ) {
    return "Options";
  }
  return accountPositionTypeDisplayLabel(
    classifyAccountPositionType({
      symbol: input.symbol,
      assetClass: input.assetClass,
      positionType: input.positionType,
      optionContract: input.optionContract,
    }),
  );
}

export function positionGroupKey(position: BrokerPositionSnapshot): string {
  if (position.optionContract) {
    const providerContractId = String(
      position.optionContract.providerContractId ??
        position.optionContract.brokerContractId ??
        "",
    ).trim();
    return optionContractGroupKey(
      position.optionContract,
      providerContractId ||
        (position.providerSecurityType?.trim().toLowerCase() === "robinhood_option"
          ? `position:${position.id}`
          : null),
    );
  }
  return `equity:${position.symbol.toUpperCase()}`;
}

export function orderGroupKey(order: BrokerOrderSnapshot): string {
  if (order.optionContract) {
    const providerContractId = String(
      order.optionContract.providerContractId ??
        order.optionContract.brokerContractId ??
        order.providerContractId ??
        "",
    ).trim();
    return optionContractGroupKey(order.optionContract, providerContractId || null);
  }
  return `equity:${order.symbol.toUpperCase()}`;
}

export function optionContractGroupKey(
  contract: NonNullable<BrokerPositionSnapshot["optionContract"]>,
  identity: string | null,
): string {
  return [
    "option",
    identity ? `provider:${identity}` : "tuple",
    contract.underlying.toUpperCase(),
    toIsoDateString(contract.expirationDate),
    contract.strike,
    contract.right,
    contract.multiplier,
    contract.sharesPerContract,
  ].join(":");
}
