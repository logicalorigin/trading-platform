import { ACCOUNT_RANGES, normalizeAccountRange } from "./accountRanges";
import { accountDateFilterBoundaryIso } from "./accountCalendarData";
import {
  feeDragBucket,
  getAccountTradeId,
  holdDurationBucket,
} from "./accountTradingAnalysis";

import { normalizeLegacyAlgoBrandText } from "../algo/algoBranding.js";

const EMPTY_ARRAY = Object.freeze([]);
const DAY_MS = 86_400_000;
const RECENT_TRADE_LIMIT = 25;
const HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  hourCycle: "h23",
});

const finiteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const arrayValue = (value) => (Array.isArray(value) ? value : EMPTY_ARRAY);

const normalizeText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const normalizeSymbol = (value) => normalizeText(value).toUpperCase();

const tradeRealizedPnl = (trade) =>
  trade?.realizedPnl == null || trade?.realizedPnl === ""
    ? null
    : finiteNumber(trade.realizedPnl);

const normalizeSelectValue = (value, fallback = "all") => {
  const text = normalizeText(value, fallback);
  return text || fallback;
};

const normalizeCloseHour = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 23) return null;
  return String(numeric).padStart(2, "0");
};

export const closeDateMatchesTradingAnalysisHour = (closeDate, closeHour) => {
  const normalizedHour = normalizeCloseHour(closeHour);
  if (normalizedHour == null) return true;
  const parsed = new Date(closeDate);
  if (Number.isNaN(parsed.getTime())) return false;
  return HOUR_FORMATTER.format(parsed) === normalizedHour;
};

const toDateInput = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);

const rangeStartDate = (range, now) => {
  const normalized = normalizeAccountRange(range);
  if (normalized === "ALL") return "";
  if (normalized === "YTD") return `${now.getFullYear()}-01-01`;
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
  return toDateInput(addDays(now, -lookbackDays));
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
  assetClass: normalizeSelectValue(filters.assetClass),
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
  const now = new Date(nowMs);
  return {
    from: rangeStartDate(normalized, now),
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

const tradeCloseMs = (trade) => {
  const raw = trade?.closeDate || trade?.exitDate || trade?.openDate;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const tradeStrategyValue = (trade) =>
  normalizeText(
    trade?.strategyLabel,
    normalizeText(
      normalizeLegacyAlgoBrandText(trade?.deploymentName),
      normalizeText(trade?.candidateId, "Unattributed"),
    ),
  );

const tradeMatchesSide = (trade, side) => {
  if (!side || side === "all") return true;
  const text = normalizeText(trade?.side).toLowerCase();
  if (side === "long") return /buy|long/.test(text);
  if (side === "short") return /sell|short/.test(text);
  return text.includes(side);
};

const buildRecentTradeIdSet = (trades) =>
  new Set(
    arrayValue(trades)
      .map((trade) => ({ trade, t: tradeCloseMs(trade) }))
      .sort((left, right) => (right.t ?? 0) - (left.t ?? 0))
      .slice(0, RECENT_TRADE_LIMIT)
      .map(({ trade }) => getAccountTradeId(trade)),
  );

export const filterAccountAnalysisTrades = ({
  trades = [],
  filters = {},
  range = "ALL",
  nowMs = Date.now(),
} = {}) => {
  const rows = arrayValue(trades);
  const normalized = normalizeTradingAnalysisFilters(filters);
  const scope = resolveTradingAnalysisDateScope({ filters: normalized, range, nowMs });
  const fromMs = accountDateFilterBoundaryIso(scope.from)
    ? new Date(accountDateFilterBoundaryIso(scope.from)).getTime()
    : null;
  const toMs = accountDateFilterBoundaryIso(scope.to, { endOfDay: true })
    ? new Date(accountDateFilterBoundaryIso(scope.to, { endOfDay: true })).getTime()
    : null;
  const recentIds = normalized.recentOnly ? buildRecentTradeIdSet(rows) : null;

  return rows.filter((trade) => {
    const closeMs = tradeCloseMs(trade);
    if (fromMs != null && (closeMs == null || closeMs < fromMs)) return false;
    if (toMs != null && (closeMs == null || closeMs > toMs)) return false;
    if (normalized.symbol && normalizeSymbol(trade?.symbol) !== normalized.symbol) return false;
    if (
      normalized.assetClass !== "all" &&
      normalizeText(trade?.assetClass).toLowerCase() !== normalized.assetClass.toLowerCase()
    ) {
      return false;
    }
    const pnl = finiteNumber(trade?.realizedPnl) ?? 0;
    if (normalized.pnlSign === "winners" && pnl <= 0) return false;
    if (normalized.pnlSign === "losers" && pnl >= 0) return false;
    if (!tradeMatchesSide(trade, normalized.side)) return false;
    if (
      normalized.holdDurations.length &&
      !normalized.holdDurations.includes(holdDurationBucket(trade?.holdDurationMinutes))
    ) {
      return false;
    }
    if (
      normalized.feeDrags.length &&
      !normalized.feeDrags.includes(feeDragBucket(trade))
    ) {
      return false;
    }
    if (
      normalized.sourceType !== "all" &&
      normalizeText(trade?.sourceType, normalizeText(trade?.source, "unknown")) !==
        normalized.sourceType
    ) {
      return false;
    }
    if (normalized.strategy !== "all" && tradeStrategyValue(trade) !== normalized.strategy) {
      return false;
    }
    if (!closeDateMatchesTradingAnalysisHour(trade?.closeDate, normalized.closeHour)) return false;
    if (recentIds && !recentIds.has(getAccountTradeId(trade))) return false;
    return true;
  });
};

const summarizeTrades = (trades) => {
  const rows = arrayValue(trades);
  const pnls = rows.map(tradeRealizedPnl).filter((value) => value != null);
  const realizedPnl = pnls.reduce((sum, value) => sum + value, 0);
  const winners = pnls.filter((value) => value > 0);
  const losers = pnls.filter((value) => value < 0);
  const grossWins = winners.reduce((sum, value) => sum + value, 0);
  const grossLosses = Math.abs(losers.reduce((sum, value) => sum + value, 0));
  const holdRows = rows
    .map((trade) => finiteNumber(trade?.holdDurationMinutes))
    .filter((value) => value != null);
  return {
    count: rows.length,
    winners: winners.length,
    losers: losers.length,
    realizedPnl,
    commissions: rows.reduce((sum, trade) => sum + (finiteNumber(trade?.commissions) ?? 0), 0),
    winRatePercent: pnls.length ? (winners.length / pnls.length) * 100 : null,
    expectancy: pnls.length ? realizedPnl / pnls.length : null,
    profitFactor:
      grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? null : 0,
    averageHoldMinutes: holdRows.length
      ? holdRows.reduce((sum, value) => sum + value, 0) / holdRows.length
      : null,
  };
};

const computeEquityCurveStats = (trades) => {
  const rows = arrayValue(trades)
    .map((trade) => ({ trade, pnl: tradeRealizedPnl(trade), t: tradeCloseMs(trade) }))
    .filter((row) => row.t != null && row.pnl != null)
    .sort((left, right) => left.t - right.t);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const curve = [];
  rows.forEach(({ pnl }) => {
    equity += pnl;
    if (equity > peak) peak = equity;
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    curve.push(equity);
  });
  return { totalPnl: equity, peakEquity: peak, maxDrawdown, curve };
};

const standardDeviation = (values, mean) => {
  if (values.length < 2) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

const computeSharpeRatio = (trades) => {
  const pnls = arrayValue(trades).map(tradeRealizedPnl).filter((value) => value != null);
  if (pnls.length < 3) return null;
  const mean = pnls.reduce((sum, value) => sum + value, 0) / pnls.length;
  const deviation = standardDeviation(pnls, mean);
  if (!deviation) return null;
  return mean / deviation;
};

const computeSortinoRatio = (trades) => {
  const pnls = arrayValue(trades).map(tradeRealizedPnl).filter((value) => value != null);
  if (pnls.length < 3) return null;
  const mean = pnls.reduce((sum, value) => sum + value, 0) / pnls.length;
  const downside = pnls.filter((value) => value < 0);
  if (!downside.length) return null;
  const downsideDeviation = Math.sqrt(
    downside.reduce((sum, value) => sum + value * value, 0) / downside.length,
  );
  if (!downsideDeviation) return null;
  return mean / downsideDeviation;
};

const computeCalmarRatio = (trades) => {
  const rows = arrayValue(trades);
  if (rows.length < 3) return null;
  const stats = computeEquityCurveStats(rows);
  if (stats.maxDrawdown <= 0) return null;
  return stats.totalPnl / stats.maxDrawdown;
};

export const buildTradingAnalysisKpis = ({ trades = [], currency = "USD" } = {}) => {
  const summary = summarizeTrades(trades);
  const equity = computeEquityCurveStats(trades);
  return {
    currency,
    sparkline: equity.curve,
    metrics: {
      trades: summary.count,
      netPnl: summary.realizedPnl,
      winRatePercent: summary.winRatePercent,
      expectancy: summary.expectancy,
      profitFactor: summary.profitFactor,
      averageHoldMinutes: summary.averageHoldMinutes,
      commissions: summary.commissions,
      maxDrawdown: equity.maxDrawdown || null,
      sharpeRatio: computeSharpeRatio(trades),
      sortinoRatio: computeSortinoRatio(trades),
      calmarRatio: computeCalmarRatio(trades),
    },
  };
};

const HOLD_LABELS = {
  "intraday-fast": "<=30m",
  intraday: "30m-4h",
  swing: "4h-1d",
  "multi-day": "Multi-day",
};

const FEE_LABELS = {
  low: "Low fee",
  medium: "Mid fee",
  high: "High fee",
  none: "No fee",
};

export const describeActiveAnalysisFilters = (filters = {}) => {
  const normalized = normalizeTradingAnalysisFilters(filters);
  const chips = [];
  if (normalized.symbol) chips.push({ key: "symbol", label: `Symbol: ${normalized.symbol}` });
  if (normalized.assetClass !== "all") {
    chips.push({ key: "assetClass", label: `Asset: ${normalized.assetClass}` });
  }
  if (normalized.pnlSign !== "all") {
    chips.push({
      key: "pnlSign",
      label: normalized.pnlSign === "winners" ? "Winners" : "Losers",
    });
  }
  if (normalized.side !== "all") {
    chips.push({ key: "side", label: normalized.side === "long" ? "Long" : "Short" });
  }
  normalized.holdDurations.forEach((value) =>
    chips.push({ key: "holdDurations", value, label: `Hold: ${HOLD_LABELS[value] || value}` }),
  );
  normalized.feeDrags.forEach((value) =>
    chips.push({ key: "feeDrags", value, label: `Fee: ${FEE_LABELS[value] || value}` }),
  );
  if (normalized.sourceType !== "all") {
    chips.push({ key: "sourceType", label: `Source: ${normalized.sourceType}` });
  }
  if (normalized.strategy !== "all") {
    chips.push({ key: "strategy", label: `Strategy: ${normalized.strategy}` });
  }
  if (normalized.closeHour != null) {
    chips.push({ key: "closeHour", label: `Close: ${normalized.closeHour}:00 ET` });
  }
  if (normalized.recentOnly) chips.push({ key: "recentOnly", label: "Recent" });
  if (normalized.from || normalized.to) {
    chips.push({
      key: "dateRange",
      label: `Dates: ${normalized.from || "..."} -> ${normalized.to || "now"}`,
    });
  }
  return chips;
};

export const buildTradingAnalysisScopeLabel = ({
  filters = {},
  range = "ALL",
  tradeCount = 0,
  totalTradeCount = 0,
  nowMs = Date.now(),
} = {}) => {
  const scope = resolveTradingAnalysisDateScope({ filters, range, nowMs });
  const scopeLabel =
    scope.source === "custom"
      ? `${scope.from || "start"} -> ${scope.to || "now"}`
      : normalizeAccountRange(range);
  const closedPct = totalTradeCount
    ? Math.round((Number(tradeCount || 0) / totalTradeCount) * 100)
    : 0;
  return `${scopeLabel} · ${tradeCount} trades · ${closedPct}% visible`;
};

export const tradeHasOptionFields = (trade) =>
  normalizeText(trade?.assetClass).toLowerCase() === "options" ||
  trade?.optionRight != null ||
  trade?.selectedContract?.right != null ||
  trade?.optionContract?.right != null ||
  trade?.dte != null ||
  trade?.strikeSlot != null;

export const buildSymbolSparklineMap = (trades = []) => {
  const bySymbol = new Map();
  arrayValue(trades)
    .map((trade) => ({ trade, pnl: tradeRealizedPnl(trade), t: tradeCloseMs(trade) }))
    .filter((row) => row.pnl != null)
    .sort((left, right) => (left.t ?? 0) - (right.t ?? 0))
    .forEach(({ trade, pnl }) => {
      const symbol = normalizeSymbol(trade?.symbol) || "UNKNOWN";
      const current = bySymbol.get(symbol) || [];
      const previous = current.length ? current[current.length - 1] : 0;
      current.push(previous + pnl);
      bySymbol.set(symbol, current);
    });
  return bySymbol;
};
