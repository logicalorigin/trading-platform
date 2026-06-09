import { normalizeSymbol } from "../lib/values";
import { resolveTickerMarket } from "./market-identity";

export type AccountPositionType = "stock" | "etf" | "option";

export type AccountPositionTypeFilter =
  | { kind: "all" }
  | { kind: "single"; value: AccountPositionType }
  | { kind: "equity" }
  | { kind: "invalid"; raw: string };

const STATIC_ETF_SYMBOLS = new Set([
  "AGG",
  "ARKK",
  "BND",
  "DIA",
  "EEM",
  "EFA",
  "GLD",
  "GOVT",
  "HYG",
  "IAU",
  "IEF",
  "IWM",
  "IVV",
  "IYR",
  "LQD",
  "QQQ",
  "SHY",
  "SLV",
  "SOXX",
  "SPY",
  "SQQQ",
  "TLT",
  "TQQQ",
  "UNG",
  "USO",
  "UUP",
  "VEA",
  "VNQ",
  "VOO",
  "VTI",
  "VWO",
  "VXX",
  "VIXY",
  "XLB",
  "XLC",
  "XLE",
  "XLF",
  "XLI",
  "XLK",
  "XLP",
  "XLU",
  "XLV",
  "XLY",
  "XRT",
]);

const compactLower = (value: unknown): string => {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  return String(value).trim().toLowerCase();
};

const rawString = (
  raw: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): string => {
  if (!raw) {
    return "";
  }
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
};

export function normalizeAccountPositionTypeFilter(
  value: unknown,
): AccountPositionTypeFilter {
  const normalized = compactLower(value);
  if (!normalized || normalized === "all") {
    return { kind: "all" };
  }
  if (normalized === "stock" || normalized === "stocks") {
    return { kind: "single", value: "stock" };
  }
  if (normalized === "etf" || normalized === "etfs") {
    return { kind: "single", value: "etf" };
  }
  if (
    normalized === "option" ||
    normalized === "options" ||
    normalized === "opt"
  ) {
    return { kind: "single", value: "option" };
  }
  if (normalized === "equity" || normalized === "equities") {
    return { kind: "equity" };
  }
  return { kind: "invalid", raw: String(value ?? "").trim() };
}

export function accountPositionTypeMatchesFilter(
  positionType: AccountPositionType,
  filter: AccountPositionTypeFilter,
): boolean {
  if (filter.kind === "all") {
    return true;
  }
  if (filter.kind === "equity") {
    return positionType === "stock" || positionType === "etf";
  }
  if (filter.kind === "single") {
    return positionType === filter.value;
  }
  return false;
}

export function accountPositionTypeDisplayLabel(
  positionType: AccountPositionType,
): "Stocks" | "ETF" | "Options" {
  if (positionType === "option") {
    return "Options";
  }
  if (positionType === "etf") {
    return "ETF";
  }
  return "Stocks";
}

export function isStaticAccountEtfSymbol(symbol: string): boolean {
  return STATIC_ETF_SYMBOLS.has(normalizeSymbol(symbol));
}

export function classifyAccountPositionType(input: {
  symbol?: string | null;
  assetClass?: string | null;
  positionType?: string | null;
  providerSecurityType?: string | null;
  optionContract?: unknown;
  raw?: Record<string, unknown> | null;
  market?: string | null;
}): AccountPositionType {
  const explicitPositionType = normalizeAccountPositionTypeFilter(
    input.positionType,
  );
  if (explicitPositionType.kind === "single") {
    return explicitPositionType.value;
  }

  const assetClass = compactLower(input.assetClass);
  const providerSecurityType = compactLower(input.providerSecurityType);
  const rawSecurityType = compactLower(
    rawString(input.raw, [
      "positionType",
      "securityType",
      "secType",
      "assetCategory",
      "assetClass",
      "type",
      "market",
    ]),
  );

  if (
    input.optionContract ||
    assetClass === "option" ||
    assetClass === "options" ||
    providerSecurityType === "opt" ||
    providerSecurityType === "option" ||
    rawSecurityType === "opt" ||
    rawSecurityType === "option"
  ) {
    return "option";
  }

  if (
    assetClass === "etf" ||
    providerSecurityType === "etf" ||
    rawSecurityType === "etf" ||
    compactLower(input.market) === "etf"
  ) {
    return "etf";
  }

  const symbol = normalizeSymbol(input.symbol ?? "");
  if (
    symbol &&
    (resolveTickerMarket({ ticker: symbol }) === "etf" ||
      isStaticAccountEtfSymbol(symbol))
  ) {
    return "etf";
  }

  return "stock";
}
