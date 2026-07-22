import { ACCOUNT_RANGES, normalizeAccountRange } from "./accountRanges";
import {
  accountDateFilterBoundaryIso,
  accountMarketDateKey,
} from "./accountCalendarData";
import { normalizeAccountPositionTypeFilter } from "../../features/account/accountPositionTypes";

const EMPTY_ARRAY = Object.freeze([]);
const arrayValue = (value) => (Array.isArray(value) ? value : EMPTY_ARRAY);

const normalizeText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const normalizeSymbol = (value) => normalizeText(value).toUpperCase();

const normalizeSelectValue = (value, fallback = "all") => {
  const text = normalizeText(value, fallback);
  return text || fallback;
};

const addCalendarDays = (dateKey, days) => {
  const adjusted = new Date(`${dateKey}T00:00:00.000Z`);
  adjusted.setUTCDate(adjusted.getUTCDate() + days);
  return adjusted.toISOString().slice(0, 10);
};

const rangeStartDate = (range, nowDateKey) => {
  const normalized = normalizeAccountRange(range);
  if (normalized === "ALL") return "";
  if (normalized === "YTD") return `${nowDateKey.slice(0, 4)}-01-01`;
  const lookbackDays =
    normalized === "1D"
      ? 0
      : normalized === "1W"
        ? 6
        : normalized === "1M"
          ? 30
          : normalized === "3M"
            ? 90
            : normalized === "6M"
              ? 180
              : normalized === "1Y"
                ? 365
                : 0;
  return addCalendarDays(nowDateKey, -lookbackDays);
};

const normalizeStringArray = (value) =>
  Array.from(
    new Set(
      arrayValue(value)
        .map((entry) => normalizeText(entry))
        .filter(Boolean),
    ),
  );

export const defaultTradingAnalysisFilters = () => ({
  symbol: "",
  assetClass: "all",
  pnlSign: "all",
  side: "all",
  holdDurations: [],
  feeDrags: [],
  sourceType: "all",
  strategy: "all",
  from: "",
  to: "",
  closeHour: null,
  recentOnly: false,
});

export const normalizeTradingAnalysisFilters = (filters = {}) => ({
  ...defaultTradingAnalysisFilters(),
  ...filters,
  symbol: normalizeSymbol(filters.symbol),
  assetClass: normalizeAccountPositionTypeFilter(filters.assetClass),
  pnlSign: normalizeSelectValue(filters.pnlSign),
  side: normalizeSelectValue(filters.side).toLowerCase(),
  holdDurations: normalizeStringArray(
    filters.holdDurations || (filters.holdDuration ? [filters.holdDuration] : []),
  ).filter((value) => value !== "all"),
  feeDrags: normalizeStringArray(
    filters.feeDrags || (filters.feeDrag ? [filters.feeDrag] : []),
  ).filter((value) => value !== "all"),
  sourceType: normalizeSelectValue(filters.sourceType),
  strategy: normalizeSelectValue(filters.strategy),
  from: normalizeText(filters.from),
  to: normalizeText(filters.to),
  closeHour: filters.closeHour == null || filters.closeHour === "" ? null : String(filters.closeHour),
  recentOnly: Boolean(filters.recentOnly),
});

export const tradingAnalysisFilterReducer = (state, action = {}) => {
  const current = normalizeTradingAnalysisFilters(state);
  if (action.type === "reset") {
    return defaultTradingAnalysisFilters();
  }
  if (action.type === "clearDateRange") {
    return { ...current, from: "", to: "" };
  }
  if (action.type === "patch") {
    return normalizeTradingAnalysisFilters({ ...current, ...(action.patch || {}) });
  }
  if (action.type === "toggleArray") {
    const key = action.key;
    const value = normalizeText(action.value);
    if (!key || !value) return current;
    const rows = new Set(arrayValue(current[key]));
    if (rows.has(value)) rows.delete(value);
    else rows.add(value);
    return normalizeTradingAnalysisFilters({ ...current, [key]: Array.from(rows) });
  }
  if (action.type === "remove") {
    const key = action.key;
    if (key === "holdDurations" || key === "feeDrags") {
      const value = normalizeText(action.value);
      return normalizeTradingAnalysisFilters({
        ...current,
        [key]: arrayValue(current[key]).filter((entry) => entry !== value),
      });
    }
    if (key === "recentOnly") return { ...current, recentOnly: false };
    if (key === "closeHour") return { ...current, closeHour: null };
    if (key === "from" || key === "to" || key === "dateRange") {
      return { ...current, from: "", to: "" };
    }
    if (key === "symbol") return { ...current, symbol: "" };
    return normalizeTradingAnalysisFilters({ ...current, [key]: defaultTradingAnalysisFilters()[key] });
  }
  return current;
};

export const buildRangeDateBounds = (range, nowMs = Date.now()) => {
  const normalized = normalizeAccountRange(range);
  if (!ACCOUNT_RANGES.includes(normalized) || normalized === "ALL") {
    return { from: "", to: "" };
  }
  const nowDateKey = accountMarketDateKey(nowMs);
  if (!nowDateKey) return { from: "", to: "" };
  return {
    from: rangeStartDate(normalized, nowDateKey),
    to: "",
  };
};

export const resolveTradingAnalysisDateScope = ({
  filters = {},
  range = "ALL",
  nowMs = Date.now(),
} = {}) => {
  const normalized = normalizeTradingAnalysisFilters(filters);
  if (normalized.from || normalized.to) {
    return { from: normalized.from, to: normalized.to, source: "custom" };
  }
  return { ...buildRangeDateBounds(range, nowMs), source: normalizeAccountRange(range) };
};

export const buildAccountAnalysisQueryParams = ({
  modeParams = {},
  filters = {},
  range = "ALL",
  nowMs = Date.now(),
} = {}) => {
  const normalized = normalizeTradingAnalysisFilters(filters);
  const scope = resolveTradingAnalysisDateScope({ filters: normalized, range, nowMs });
  const holdDurations = arrayValue(normalized.holdDurations);
  return {
    ...modeParams,
    symbol: normalized.symbol || undefined,
    assetClass:
      normalized.assetClass && normalized.assetClass !== "all"
        ? normalized.assetClass
        : undefined,
    pnlSign:
      normalized.pnlSign && normalized.pnlSign !== "all"
        ? normalized.pnlSign
        : undefined,
    holdDuration: holdDurations.length === 1 ? holdDurations[0] : undefined,
    from: accountDateFilterBoundaryIso(scope.from),
    to: accountDateFilterBoundaryIso(scope.to, { endOfDay: true }),
  };
};
