export type AccountPositionType = "stock" | "etf" | "option";
export type AccountPositionTypeFilter = AccountPositionType | "equity" | "all";

const LEGACY_POSITION_TYPE_ALIASES: Record<string, AccountPositionTypeFilter> = {
  all: "all",
  any: "all",
  equity: "equity",
  equities: "equity",
  stock: "stock",
  stocks: "stock",
  stk: "stock",
  etf: "etf",
  etfs: "etf",
  fund: "etf",
  option: "option",
  options: "option",
  opt: "option",
};

export const ACCOUNT_POSITION_TYPE_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "equity", label: "Equity" },
  { value: "stock", label: "Stock" },
  { value: "etf", label: "ETF" },
  { value: "option", label: "Option" },
] as const;

export const ACCOUNT_POSITION_TYPE_SETTINGS_OPTIONS = [
  { value: "all", label: "All positions" },
  { value: "equity", label: "Stocks + ETFs" },
  { value: "stock", label: "Stocks" },
  { value: "etf", label: "ETFs" },
  { value: "option", label: "Options" },
] as const;

export const normalizeAccountPositionTypeFilter = (
  value: unknown,
): AccountPositionTypeFilter => {
  const key = String(value ?? "").trim().toLowerCase();
  return LEGACY_POSITION_TYPE_ALIASES[key] ?? "all";
};

export const accountPositionTypeParam = (
  value: unknown,
): AccountPositionTypeFilter | undefined => {
  const normalized = normalizeAccountPositionTypeFilter(value);
  return normalized === "all" ? undefined : normalized;
};

export const normalizeAccountPositionType = (
  value: unknown,
): AccountPositionType | null => {
  const normalized = normalizeAccountPositionTypeFilter(value);
  return normalized === "all" || normalized === "equity" ? null : normalized;
};
