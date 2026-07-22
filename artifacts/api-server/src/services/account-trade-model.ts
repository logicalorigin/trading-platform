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

function optionContractGroupKey(
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
