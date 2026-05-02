import type {
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
} from "../providers/ibkr/client";

export type OrderTab = "working" | "history";

const ETF_SYMBOLS = new Set([
  "SPY",
  "QQQ",
  "IWM",
  "DIA",
  "TLT",
  "IEF",
  "GLD",
  "USO",
  "SOXX",
  "VXX",
  "VIXY",
]);

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function isEtfSymbol(symbol: string): boolean {
  return ETF_SYMBOLS.has(symbol.toUpperCase());
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
  if (position.assetClass === "option") {
    return "Options";
  }
  if (isEtfSymbol(position.symbol)) {
    return "ETF";
  }
  return "Stocks";
}

export function normalizeTradeAssetClassLabel(input: {
  assetClass: string | null | undefined;
  symbol: string;
}): string {
  const normalized = (input.assetClass ?? "").trim().toLowerCase();
  if (normalized.includes("option")) {
    return "Options";
  }
  if (isEtfSymbol(input.symbol)) {
    return "ETF";
  }
  return "Stocks";
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
