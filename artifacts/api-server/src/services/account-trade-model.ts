import type {
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
} from "../providers/ibkr/client";
import {
  accountPositionTypeDisplayLabel,
  classifyAccountPositionType,
  isStaticAccountEtfSymbol,
} from "./account-position-type";

export type OrderTab = "working" | "history";

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
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
    return [
      "option",
      position.optionContract.underlying,
      formatDateOnly(position.optionContract.expirationDate),
      position.optionContract.strike,
      position.optionContract.right,
    ].join(":");
  }
  return `equity:${position.symbol.toUpperCase()}`;
}

export function orderGroupKey(order: BrokerOrderSnapshot): string {
  if (order.optionContract) {
    return [
      "option",
      order.optionContract.underlying,
      formatDateOnly(order.optionContract.expirationDate),
      order.optionContract.strike,
      order.optionContract.right,
    ].join(":");
  }
  return `equity:${order.symbol.toUpperCase()}`;
}
