import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList,
  Eye,
  Info,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  Ticket,
  XCircle,
  Zap,
} from "lucide-react";
import {
  getStoredOptionQuoteSnapshot,
  useStoredOptionQuoteSnapshotVersion,
} from "../../features/platform/live-streams";
import {
  PositionOptionQuoteStreams,
  buildPositionOptionQuoteGroups,
  rowOptionProviderContractIds,
} from "./PositionOptionQuoteStreams.jsx";
import {
  CSS_COLOR,
  cssColorMix,
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatEnumLabel, formatRelativeTimeShort } from "../../lib/formatters";
import { useValueFlash } from "../../lib/motion.jsx";
import { formatAppDateTime } from "../../lib/timeZone";
import { normalizeLegacyAlgoBrandText } from "../algo/algoBranding.js";
import {
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
  cellSubTextStyle,
  formatAccountMoney,
  formatAccountPercent,
  formatAccountPrice,
  formatAccountSignedMoney,
  formatNumber,
  moveTableFocus,
  mutedLabelStyle,
  tableCellStyle,
  tableHeaderStyle,
  toneForValue,
} from "./accountUtils";
import { MicroSparkline } from "../../components/platform/primitives.jsx";
import { DataIssueInlineIcon } from "../../components/platform/DataIssueInlineIcon.jsx";
import {
  SortableColumnHeaderCell,
  TableHeaderDndContext,
} from "../../components/platform/InteractiveColumnHeader.jsx";
import {
  normalizeColumnOrder,
  orderColumnsById,
  reorderColumnOrder,
} from "../../components/platform/tableColumnInteractions.js";
import { Button } from "../../components/ui/Button.jsx";
import { PaginationFooter, paginateRows } from "../../components/platform/TablePagination.jsx";
import { getOpenPositionRows } from "../../features/account/accountPositionRows.js";
import {
  buildPositionDisplayModel,
  formatPositionQuoteFreshnessLabel,
  formatPositionSpreadLabel,
  positionCostBasis,
} from "../../features/account/positionDisplayModel.js";
import {
  buildPositionTradeManagement,
  TRADE_MANAGEMENT_STATUS,
} from "../../features/account/positionTradeManagement.js";
import {
  POSITION_TABLE_SURFACE_ALGO,
  POSITION_TABLE_SURFACE_ACCOUNT,
  getPositionTableColumns,
  positionTableColumnIdsForSurface,
} from "../../features/account/positionTableColumns.js";
import { PositionRowActionMenu } from "../../features/account/PositionRowActionMenu.jsx";
import { PositionProtectionEditor } from "../../features/account/PositionProtectionEditor.jsx";
import {
  buildCloseOrderRequest,
  buildStopOrderRequest,
} from "../../features/account/positionOrderActions.js";
import { usePlaceOrder, usePreviewOrder, useReplaceOrder } from "@workspace/api-client-react";
import { useToast } from "../../features/platform/platformContexts.jsx";
import {
  BrokerActionConfirmDialog,
  formatLiveBrokerActionError,
} from "../../features/trade/BrokerActionConfirmDialog.jsx";
import {
  usePositionQuoteSnapshots,
  useRegisterPositionMarketDataSymbols,
} from "../../features/platform/positionMarketDataStore";
import { useRuntimeTickerSnapshots } from "../../features/platform/runtimeTickerStore";
import { collectQuoteDataIssues } from "../../features/platform/dataIssueModel.js";
import {
  SPARKLINE_RENDER_POINT_LIMIT,
  TABLE_SPARKLINE_COMPACT_HEIGHT,
  TABLE_SPARKLINE_COMPACT_WIDTH,
  TABLE_SPARKLINE_HEIGHT,
  TABLE_SPARKLINE_WIDTH,
  buildDetailedFallbackSparklineData,
} from "../../features/platform/sparklineConfig";
import { normalizeTickerSymbol } from "../../features/platform/tickerIdentity";
import { buildPositionsAtDateInspectorState } from "./positionsAtDateInspectorModel.js";
import { AppTooltip } from "@/components/ui/tooltip";
import { useDebouncedTextCommit } from "../../lib/useDebouncedTextCommit";
import { _initialState, persistState } from "../../lib/workspaceState";
import { ACCOUNT_POSITION_TYPE_FILTER_OPTIONS } from "../../features/account/accountPositionTypes";

const ASSET_FILTERS = ACCOUNT_POSITION_TYPE_FILTER_OPTIONS;

const SOURCE_FILTERS = [
  { value: "all", label: "All Sources" },
  { value: "manual", label: "Manual" },
  { value: "automation", label: "Automation" },
  { value: "signal_options_replay", label: "Options Replay" },
  { value: "watchlist_backtest", label: "Watchlist BT" },
  { value: "mixed", label: "Mixed" },
];

const POSITIONS_PAGE_SIZE = 50;
const POSITION_LOCKED_COLUMN_IDS = ["symbol", "actions"];

const PositionSymbolSearchInput = ({ value, onCommit, isPhone }) => {
  const { inputProps } = useDebouncedTextCommit({
    value,
    onCommit,
  });

  return (
    <input
      aria-label="Search positions by symbol"
      {...inputProps}
      placeholder="Search symbol"
      style={{
        width: isPhone ? dim(118) : dim(138),
        height: dim(24),
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.xs),
        background: CSS_COLOR.bg0,
        color: CSS_COLOR.text,
        fontFamily: T.sans,
        fontSize: textSize("body"),
        outline: "none",
        padding: sp("0 8px"),
      }}
    />
  );
};

const positionColumnOrderStateKey = (surfaceId) =>
  surfaceId === POSITION_TABLE_SURFACE_ALGO
    ? "algoPositionColumnOrder"
    : "accountPositionColumnOrder";

const sourceTone = (sourceType) =>
  sourceType === "automation"
    ? "category-automation"
    : sourceType === "watchlist_backtest"
      ? "category-backtest"
      : sourceType === "mixed"
        ? "category-mixed"
        : "default";

const compactKeyPart = (value) => String(value ?? "").trim();

const positionOpenOrderKey = (rowId, order, index) =>
  [
    rowId,
    order?.id,
    order?.accountId,
    order?.symbol,
    order?.side,
    order?.type,
    order?.placedAt,
    index,
  ]
    .map(compactKeyPart)
    .filter(Boolean)
    .join(":");

const positionSourceAttributionKey = (rowId, source, index) =>
  [
    rowId,
    source?.candidateId,
    source?.sourceEventId,
    source?.sourceType,
    source?.quantity,
    index,
  ]
    .map(compactKeyPart)
    .filter(Boolean)
    .join(":");

const lotColumns = ["Account", "Qty", "Avg Cost", "Market Value", "Unrealized"];

const finiteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric != null) return numeric;
  }
  return null;
};

// Broker (SnapTrade) marks are the source of truth for the account Positions MONEY
// columns (market value, unrealized P&L) and the account TOTALS. The live Massive quote
// is surfaced ONLY as the displayed Price overlay, never as money. These readers prefer
// the preserved broker value and fall back to the live value when it is absent (e.g.
// shadow-ledger rows have no broker and intentionally stay on Massive valuation) so money
// cells never render blank. NOTE: `finiteNumber(null)` is 0 here (Number(null) === 0), so
// the broker field is chosen with `??` BEFORE the finite check — otherwise a null broker
// value would coerce to 0 instead of falling back to the live value.
const brokerMoneyValue = (brokerValue, liveValue) => {
  const value = brokerValue ?? liveValue;
  return value == null ? null : finiteNumber(value);
};
const brokerMarketValueForRow = (row) =>
  brokerMoneyValue(row?.brokerMarketValue, row?.marketValue);
const brokerUnrealizedPnlForRow = (row) =>
  brokerMoneyValue(row?.brokerUnrealizedPnl, row?.unrealizedPnl);
const brokerUnrealizedPnlPercentForRow = (row) =>
  brokerMoneyValue(row?.brokerUnrealizedPnlPercent, row?.unrealizedPnlPercent);

const firstPositiveFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric != null && numeric > 0) return numeric;
  }
  return null;
};

const firstText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
};

const isInternalOptionIdentifier = (value) =>
  /^twsopt:/i.test(String(value ?? "").trim());

const firstDisplayText = (...values) => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && !isInternalOptionIdentifier(text)) return text;
  }
  return "";
};

const quoteTimestampMs = (value) => {
  if (!value) return null;
  const timestamp =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const optionQuoteStatusRank = (value) => {
  switch (firstText(value).toLowerCase()) {
    case "live":
      return 5;
    case "stale":
      return 4;
    case "pending":
      return 3;
    case "unavailable":
      return 2;
    case "rejected":
      return 1;
    default:
      return 0;
  }
};

const liveOptionQuoteStatusRank = (quote) =>
  optionQuoteStatusRank(
    firstText(
      quote?.quoteStatus,
      quote?.status,
      quote?.quoteFreshness,
      quote?.freshness,
    ),
  );

const liveOptionQuoteTimestampMs = (quote) =>
  quoteTimestampMs(firstText(quote?.dataUpdatedAt, quote?.updatedAt, quote?.quoteUpdatedAt));

const compareLiveOptionQuotes = (left, right) => {
  if (!left && !right) return 0;
  if (left && !right) return 1;
  if (!left && right) return -1;

  const leftStatusRank = liveOptionQuoteStatusRank(left);
  const rightStatusRank = liveOptionQuoteStatusRank(right);
  if (leftStatusRank !== rightStatusRank) {
    return leftStatusRank - rightStatusRank;
  }

  const leftFreshnessRank = optionQuoteStatusRank(left?.freshness);
  const rightFreshnessRank = optionQuoteStatusRank(right?.freshness);
  if (leftFreshnessRank !== rightFreshnessRank) {
    return leftFreshnessRank - rightFreshnessRank;
  }

  const leftTimestamp = liveOptionQuoteTimestampMs(left);
  const rightTimestamp = liveOptionQuoteTimestampMs(right);
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  if (leftTimestamp !== null && rightTimestamp === null) return 1;
  if (leftTimestamp === null && rightTimestamp !== null) return -1;

  const leftCacheAge = firstFiniteNumber(left?.cacheAgeMs, left?.ageMs);
  const rightCacheAge = firstFiniteNumber(right?.cacheAgeMs, right?.ageMs);
  if (leftCacheAge !== null && rightCacheAge !== null && leftCacheAge !== rightCacheAge) {
    return rightCacheAge - leftCacheAge;
  }
  if (leftCacheAge !== null && rightCacheAge === null) return 1;
  if (leftCacheAge === null && rightCacheAge !== null) return -1;

  return 0;
};

const freshestLiveOptionQuoteForRow = (row, liveQuoteByProviderContractId = {}) =>
  rowOptionProviderContractIds(row)
    .map((providerContractId) => liveQuoteByProviderContractId[providerContractId])
    .filter(Boolean)
    .reduce(
      (best, quote) =>
        compareLiveOptionQuotes(quote, best) > 0 ? quote : best,
      null,
    );

const formatOptionRightLabel = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "call" || normalized === "c") return "CALL";
  if (normalized === "put" || normalized === "p") return "PUT";
  return normalized ? normalized.toUpperCase() : MISSING_VALUE;
};

const compactOptionDate = (year, month, day) => {
  const shortYear = String(year).slice(-2).padStart(2, "0");
  return `${Number(month)}/${Number(day)}/${shortYear}`;
};

const formatOptionExpiryLabel = (value) => {
  const text = firstText(value);
  if (!text) return "";

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (isoDate) {
    return compactOptionDate(isoDate[1], isoDate[2], isoDate[3]);
  }

  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compactDate) {
    return compactOptionDate(compactDate[1], compactDate[2], compactDate[3]);
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return compactOptionDate(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth() + 1,
      parsed.getUTCDate(),
    );
  }

  return text;
};

const optionContractLabel = (contract) => {
  const underlying = firstDisplayText(contract?.underlying, contract?.symbol);
  const terms = optionContractTermsLabel(contract);
  return [underlying, terms]
    .filter((value) => value && value !== MISSING_VALUE)
    .join(" ") || MISSING_VALUE;
};

const optionContractTermsLabel = (contract) => {
  const expiry = formatOptionExpiryLabel(
    firstText(contract?.expirationDate, contract?.exp, contract?.expiry),
  );
  const strike = contract?.strike == null ? "" : formatNumber(contract.strike, 4);
  const right = formatOptionRightLabel(contract?.right || contract?.cp);
  return [expiry, strike, right]
    .filter((value) => value && value !== MISSING_VALUE)
    .join(" ") || MISSING_VALUE;
};

const formatOptionPrice = (value, maskValues) =>
  value == null ? MISSING_VALUE : formatAccountPrice(value, 2, maskValues);

const formatQuoteBidAsk = (quote, maskValues) => {
  const bid = firstFiniteNumber(quote?.bid);
  const ask = firstFiniteNumber(quote?.ask);
  if (bid == null && ask == null) return MISSING_VALUE;
  return `${formatOptionPrice(bid, maskValues)} / ${formatOptionPrice(ask, maskValues)}`;
};

const optionDisplayQuote = (row) =>
  buildPositionDisplayModel(row, row?.optionQuote).quote ?? row?.optionQuote ?? row?.quote ?? null;

const quoteMid = (quote) => {
  const bid = firstFiniteNumber(quote?.bid);
  const ask = firstFiniteNumber(quote?.ask);
  return bid != null && ask != null && bid > 0 && ask > 0
    ? (bid + ask) / 2
    : null;
};

const liveQuoteChangeFieldsAreUsable = (liveQuote) => {
  const price = firstPositiveFiniteNumber(
    liveQuote?.mark,
    liveQuote?.mid,
    liveQuote?.last,
    liveQuote?.price,
    quoteMid(liveQuote),
  );
  if (price == null) return false;

  const change = firstFiniteNumber(
    liveQuote?.dayChange,
    liveQuote?.change,
    liveQuote?.netChange,
  );
  const changePercent = firstFiniteNumber(
    liveQuote?.dayChangePercent,
    liveQuote?.changePercent,
    liveQuote?.percentChange,
  );
  if (change == null || changePercent == null) return true;

  const previous = price - change;
  if (!Number.isFinite(previous) || previous <= 0) return false;
  const impliedPercent = (change / previous) * 100;
  const tolerance = Math.max(2, Math.abs(changePercent) * 0.05);
  return Math.abs(impliedPercent - changePercent) <= tolerance;
};

const liveOptionQuoteValuationEligible = (liveQuote) => {
  if (!liveQuote) return false;
  const bid = firstPositiveFiniteNumber(liveQuote.bid);
  const ask = firstPositiveFiniteNumber(liveQuote.ask);
  if (bid == null || ask == null) return false;
  const freshness = firstText(liveQuote.freshness, liveQuote.quoteFreshness).toLowerCase();
  if (["metadata", "pending", "stale", "unavailable", "frozen", "delayed", "delayed_frozen"].includes(freshness)) {
    return false;
  }
  const marketDataMode = firstText(liveQuote.marketDataMode).toLowerCase();
  return !marketDataMode || marketDataMode === "live";
};

const mergeLiveOptionQuote = (quote, liveQuote) => {
  if (!liveQuote) return quote || null;
  const current = quote || {};
  const liveHasUsableChange = liveQuoteChangeFieldsAreUsable(liveQuote);
  const bid = firstFiniteNumber(liveQuote.bid, current.bid);
  const ask = firstFiniteNumber(liveQuote.ask, current.ask);
  const last = firstPositiveFiniteNumber(
    liveQuote.last,
    liveQuote.price,
    current.last,
    current.price,
  );
  const mid = firstPositiveFiniteNumber(liveQuote.mid, current.mid, quoteMid({ bid, ask }));
  return {
    ...current,
    providerContractId: firstText(liveQuote.providerContractId, current.providerContractId),
    bid,
    ask,
    mid,
    last,
    price: firstPositiveFiniteNumber(
      liveQuote.price,
      liveQuote.last,
      current.price,
      current.last,
    ),
    mark: firstPositiveFiniteNumber(
      mid,
      liveQuote.mark,
      liveQuote.price,
      liveQuote.last,
      current.mark,
    ),
    dayChange: liveHasUsableChange
      ? firstFiniteNumber(
          liveQuote.dayChange,
          liveQuote.change,
          liveQuote.netChange,
          current.dayChange,
        )
      : current.dayChange,
    dayChangePercent: liveHasUsableChange
      ? firstFiniteNumber(
          liveQuote.dayChangePercent,
          liveQuote.changePercent,
          liveQuote.percentChange,
          current.dayChangePercent,
        )
      : current.dayChangePercent,
    impliedVolatility: firstFiniteNumber(liveQuote.impliedVolatility, current.impliedVolatility),
    delta: firstFiniteNumber(liveQuote.delta, current.delta),
    gamma: firstFiniteNumber(liveQuote.gamma, current.gamma),
    theta: firstFiniteNumber(liveQuote.theta, current.theta),
    vega: firstFiniteNumber(liveQuote.vega, current.vega),
    underlyingPrice: firstPositiveFiniteNumber(
      liveQuote.underlyingPrice,
      current.underlyingPrice,
    ),
    openInterest: firstFiniteNumber(liveQuote.openInterest, current.openInterest),
    volume: firstFiniteNumber(liveQuote.volume, current.volume),
    quoteFreshness: firstText(liveQuote.freshness, current.quoteFreshness, current.freshness),
    greeksFreshness: firstText(liveQuote.greeksFreshness, current.greeksFreshness),
    status: firstText(liveQuote.status, liveQuote.quoteStatus, current.status),
    reason: firstText(liveQuote.reason, liveQuote.quoteReason, current.reason),
    quoteStatus: firstText(liveQuote.quoteStatus, liveQuote.status, current.quoteStatus),
    quoteReason: firstText(liveQuote.quoteReason, current.quoteReason),
    greeksStatus: firstText(liveQuote.greeksStatus, current.greeksStatus),
    greeksReason: firstText(liveQuote.greeksReason, current.greeksReason),
    demandStatus: firstText(liveQuote.demandStatus, current.demandStatus),
    demandReason: firstText(liveQuote.demandReason, current.demandReason),
    unavailableDetail: firstText(liveQuote.unavailableDetail, current.unavailableDetail),
    cacheAgeMs: firstFiniteNumber(liveQuote.cacheAgeMs, current.cacheAgeMs),
    ageMs: firstFiniteNumber(liveQuote.ageMs, current.ageMs),
    marketDataMode: firstText(liveQuote.marketDataMode, current.marketDataMode),
    quoteUpdatedAt: firstText(liveQuote.dataUpdatedAt, liveQuote.updatedAt, current.quoteUpdatedAt),
    dataUpdatedAt: firstText(liveQuote.dataUpdatedAt, liveQuote.updatedAt, current.dataUpdatedAt),
    updatedAt: firstText(liveQuote.updatedAt, current.updatedAt),
    source: "option_quote",
  };
};

const isShadowLedgerPositionRow = (row) =>
  String(row?.accountId || "").toLowerCase() === "shadow" ||
  String(row?.source || "").toUpperCase() === "SHADOW_LEDGER";

const shadowRowAllowsLiveOptionValuation = (row, liveQuote) =>
  !isShadowLedgerPositionRow(row) ||
  (row?.valuationEligible === true && liveOptionQuoteValuationEligible(liveQuote));

const positionMarketDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateOrNull = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const raw = value.trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return new Date(
      Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), 12),
    );
  }
  const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dashed) {
    return new Date(
      Date.UTC(Number(dashed[1]), Number(dashed[2]) - 1, Number(dashed[3]), 12),
    );
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dateOnlyMarketDateKey = (value) => {
  if (typeof value === "string") {
    const raw = value.trim();
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  }
  if (
    value instanceof Date &&
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  ) {
    return value.toISOString().slice(0, 10);
  }
  return null;
};

const marketDateKey = (value) => {
  const dateOnlyKey = dateOnlyMarketDateKey(value);
  if (dateOnlyKey) return dateOnlyKey;
  const date = dateOrNull(value);
  if (!date) return null;
  const parts = positionMarketDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
};

const positionOpenedOnCurrentMarketDay = (openedAt, now = new Date()) => {
  const opened = dateOrNull(openedAt);
  const observedAt = dateOrNull(now);
  if (!opened || !observedAt) {
    return false;
  }
  const openedKey = marketDateKey(opened);
  const nowKey = marketDateKey(observedAt);
  if (openedKey && nowKey && openedKey === nowKey) {
    return true;
  }
  if (opened.getTime() > observedAt.getTime()) {
    return false;
  }
  return Boolean(openedKey && nowKey && openedKey === nowKey);
};

const optionPositionMultiplier = (row) => {
  if (!isOptionPosition(row)) return 1;
  return firstFiniteNumber(
    row?.optionContract?.multiplier,
    row?.optionContract?.sharesPerContract,
    100,
  );
};

const optionPriceLooksContractScaled = (row, price, multiplier) => {
  if (!isOptionPosition(row) || multiplier == null || multiplier <= 1 || price <= 0) {
    return false;
  }

  const quantity = Math.abs(firstFiniteNumber(row?.quantity) ?? 0);
  const marketValue = Math.abs(firstFiniteNumber(row?.marketValue) ?? 0);
  const unrealizedPnl = firstFiniteNumber(row?.unrealizedPnl);

  // Accurate check first: if the row's own marketValue and unrealizedPnl imply a
  // per-share (premium) basis, the price is NOT contract-scaled — even when avg==mark
  // makes it look like a flat fallback below. Running this BEFORE the flat-fallback
  // heuristic stops an already-normalized $50+/share premium from being divided by the
  // multiplier a second time (which rendered Avg 100x too small and blew up same-day Day $/%).
  const inferredCostBasis =
    marketValue > 0 && unrealizedPnl != null
      ? Math.abs(marketValue - unrealizedPnl)
      : null;
  if (inferredCostBasis != null && inferredCostBasis > 1e-9 && quantity > 1e-9) {
    const contractScaledBasis = Math.abs(price * quantity);
    const premiumBasis = Math.abs(price * quantity * multiplier);
    const contractScaledDistance =
      Math.abs(contractScaledBasis - inferredCostBasis) / inferredCostBasis;
    const premiumDistance =
      Math.abs(premiumBasis - inferredCostBasis) / inferredCostBasis;
    if (contractScaledDistance <= 0.02 && premiumDistance > 0.02) {
      return true;
    }
    if (premiumDistance <= 0.02 && contractScaledDistance > 0.02) {
      return false;
    }
  }

  const rawAveragePrice = firstFiniteNumber(row?.averagePrice, row?.averageCost);
  const rawMarketPrice = firstFiniteNumber(row?.marketPrice, row?.mark);
  const rawPriceIsFlatFallback =
    rawAveragePrice != null &&
    rawMarketPrice != null &&
    Math.abs(rawAveragePrice - rawMarketPrice) <= 1e-9 &&
    unrealizedPnl != null &&
    Math.abs(unrealizedPnl) <= 0.01;
  if (price >= multiplier * 0.5 && rawPriceIsFlatFallback) {
    return true;
  }

  return price >= multiplier * 0.5;
};

const normalizeOptionPremiumPrice = (row, value) => {
  const price = firstFiniteNumber(value);
  if (price == null) return null;
  const multiplier = optionPositionMultiplier(row);
  return optionPriceLooksContractScaled(row, price, multiplier)
    ? price / multiplier
    : price;
};

const applyLiveOptionQuoteToRow = (row, liveQuote) => {
  const optionQuote = mergeLiveOptionQuote(row.optionQuote, liveQuote);
  if (!optionQuote && !liveQuote) return row;
  const liveValuationAllowed = shadowRowAllowsLiveOptionValuation(row, liveQuote);
  const displayOptionQuote = liveValuationAllowed
    ? optionQuote
    : {
        ...optionQuote,
        mark: firstPositiveFiniteNumber(row?.optionQuote?.mark, row?.mark),
        dayChange: firstFiniteNumber(row?.optionQuote?.dayChange),
        dayChangePercent: firstFiniteNumber(row?.optionQuote?.dayChangePercent),
      };
  const mark = firstPositiveFiniteNumber(
    liveValuationAllowed ? displayOptionQuote?.mark : null,
    liveValuationAllowed ? displayOptionQuote?.mid : null,
    liveValuationAllowed ? quoteMid(displayOptionQuote) : null,
    liveValuationAllowed ? displayOptionQuote?.last : null,
    liveValuationAllowed ? displayOptionQuote?.price : null,
    row.mark,
  );
  const quantity = firstFiniteNumber(row.quantity);
  const averageCost = normalizeOptionPremiumPrice(row, row.averageCost);
  const multiplier = optionPositionMultiplier(row);
  const marketValue =
    mark != null && quantity != null && multiplier != null
      ? mark * quantity * multiplier
      : row.marketValue;
  const unrealizedPnl =
    mark != null && averageCost != null && quantity != null && multiplier != null
      ? (mark - averageCost) * quantity * multiplier
      : row.unrealizedPnl;
  const costBasis =
    averageCost != null && quantity != null && multiplier != null
      ? Math.abs(averageCost * quantity * multiplier)
      : null;
  const unrealizedPnlPercent =
    unrealizedPnl != null && costBasis
      ? (unrealizedPnl / costBasis) * 100
      : row.unrealizedPnlPercent;
  const perContractDayChange = firstFiniteNumber(displayOptionQuote?.dayChange);
  const sameDayPosition = positionOpenedOnCurrentMarketDay(row.openedAt);
  const dayChange =
    sameDayPosition && unrealizedPnl != null
      ? unrealizedPnl
      : perContractDayChange != null && quantity != null && multiplier != null
      ? perContractDayChange * quantity * multiplier
      : row.dayChange;
  // The option quote's own dayChangePercent is the contract's price move; for a SHORT
  // the position's Day % is inverted, so it must carry the position sign to match Day $
  // (perContractDayChange * quantity) in the same cell.
  const perContractDayChangePercent = firstFiniteNumber(
    optionQuote?.dayChangePercent,
    row.dayChangePercent,
  );
  const dayChangePercent =
    sameDayPosition && unrealizedPnlPercent != null
      ? unrealizedPnlPercent
      : perContractDayChangePercent != null && quantity != null && quantity !== 0
      ? perContractDayChangePercent * Math.sign(quantity)
      : perContractDayChangePercent;
  const preserveBackendDayChange = Boolean(
    !sameDayPosition &&
      isShadowLedgerPositionRow(row) &&
      (firstFiniteNumber(row.dayChange) != null ||
        firstFiniteNumber(row.dayChangePercent) != null),
  );
  const delta = firstFiniteNumber(optionQuote?.delta);
  const underlyingPrice = firstPositiveFiniteNumber(
    optionQuote?.underlyingPrice,
    displayOptionQuote?.underlyingPrice,
    row?.optionQuote?.underlyingPrice,
  );
  const underlyingQuoteSource = firstText(
    optionQuote?.underlyingPriceSource,
    displayOptionQuote?.underlyingPriceSource,
    optionQuote?.source,
    displayOptionQuote?.source,
  );
  const underlyingMarket =
    underlyingPrice != null
      ? {
          ...(row.underlyingMarket || {}),
          symbol:
            resolvePositionUnderlyingSymbol(row) ||
            row.underlyingMarket?.symbol ||
            row.symbol,
          price: underlyingPrice,
          mark: underlyingPrice,
          updatedAt: firstText(
            optionQuote?.dataUpdatedAt,
            optionQuote?.updatedAt,
            row.underlyingMarket?.updatedAt,
          ),
          dataUpdatedAt: firstText(
            optionQuote?.dataUpdatedAt,
            row.underlyingMarket?.dataUpdatedAt,
          ),
          source: underlyingQuoteSource === "massive" ? "massive" : "ibkr",
          transport: firstText(
            optionQuote?.transport,
            row.underlyingMarket?.transport,
          ),
        }
      : row.underlyingMarket;

  // Preserve the incoming broker (SnapTrade) money as the source of truth for the money
  // columns/totals; the live values above stay for the Price overlay only. Shadow-ledger
  // rows have no broker, so leave the broker fields null and let readers fall back to live
  // (Massive) valuation.
  const preserveBrokerMoney = !isShadowLedgerPositionRow(row);
  return {
    ...row,
    ...(underlyingMarket ? { underlyingMarket } : {}),
    optionQuote: displayOptionQuote,
    averageCost: averageCost ?? row.averageCost,
    mark,
    dayChange: preserveBackendDayChange ? row.dayChange : dayChange,
    dayChangePercent: preserveBackendDayChange
      ? row.dayChangePercent
      : dayChangePercent,
    unrealizedPnl,
    unrealizedPnlPercent,
    marketValue,
    brokerMarketValue: preserveBrokerMoney
      ? firstFiniteNumber(row.brokerMarketValue ?? row.marketValue)
      : null,
    brokerUnrealizedPnl: preserveBrokerMoney
      ? firstFiniteNumber(row.brokerUnrealizedPnl ?? row.unrealizedPnl)
      : null,
    brokerUnrealizedPnlPercent: preserveBrokerMoney
      ? firstFiniteNumber(row.brokerUnrealizedPnlPercent ?? row.unrealizedPnlPercent)
      : null,
    betaWeightedDelta:
      delta != null && quantity != null && multiplier != null
        ? delta * quantity * multiplier
        : row.betaWeightedDelta,
  };
};

const applyFreshestLiveOptionQuoteToRow = (
  row,
  liveQuoteByProviderContractId = {},
) =>
  applyLiveOptionQuoteToRow(
    row,
    freshestLiveOptionQuoteForRow(row, liveQuoteByProviderContractId),
  );

const isOptionPosition = (row) =>
  Boolean(row?.optionContract) ||
  String(row?.positionType || "").toLowerCase() === "option" ||
  ["option", "options"].includes(String(row?.assetClass || "").toLowerCase());

const resolvePositionUnderlyingSymbol = (row) => {
  const symbol = firstDisplayText(
    row?.marketDataSymbol,
    row?.optionContract?.underlying,
    row?.underlyingMarket?.symbol,
    row?.symbol,
  );
  const normalized = normalizeTickerSymbol(symbol);
  return normalized && !isInternalOptionIdentifier(normalized) ? normalized : "";
};

const resolvePositionSparklineSymbol = (row) => resolvePositionUnderlyingSymbol(row);

const mergeLiveEquityQuote = (quote, liveQuote) => {
  if (!liveQuote) return quote || null;
  const current = quote || {};
  const bid = firstPositiveFiniteNumber(liveQuote.bid, current.bid);
  const ask = firstPositiveFiniteNumber(liveQuote.ask, current.ask);
  const mid = firstPositiveFiniteNumber(liveQuote.mid, current.mid, quoteMid({ bid, ask }));
  const mark = firstPositiveFiniteNumber(
    liveQuote.mark,
    liveQuote.price,
    liveQuote.last,
    mid,
    current.mark,
    current.price,
    current.last,
  );
  const spread = bid != null && ask != null ? ask - bid : firstFiniteNumber(current.spread);
  const spreadPercent =
    spread != null && mark != null && mark > 0
      ? (spread / mark) * 100
      : firstFiniteNumber(current.spreadPercent);

  return {
    ...current,
    bid,
    ask,
    mid,
    last: firstPositiveFiniteNumber(liveQuote.last, liveQuote.price, current.last, current.price),
    price: firstPositiveFiniteNumber(liveQuote.price, liveQuote.last, current.price, current.last),
    mark,
    dayChange: firstFiniteNumber(
      liveQuote.dayChange,
      liveQuote.chg,
      liveQuote.change,
      liveQuote.netChange,
      current.dayChange,
    ),
    dayChangePercent: firstFiniteNumber(
      liveQuote.dayChangePercent,
      liveQuote.pct,
      liveQuote.changePercent,
      liveQuote.percentChange,
      current.dayChangePercent,
    ),
    spread,
    spreadPercent,
    bidSize: firstFiniteNumber(liveQuote.bidSize, current.bidSize),
    askSize: firstFiniteNumber(liveQuote.askSize, current.askSize),
    volume: firstFiniteNumber(liveQuote.volume, current.volume),
    freshness: firstText(liveQuote.freshness, current.freshness),
    marketDataMode: firstText(liveQuote.marketDataMode, current.marketDataMode),
    quoteUpdatedAt: firstText(liveQuote.dataUpdatedAt, liveQuote.updatedAt, current.quoteUpdatedAt),
    dataUpdatedAt: firstText(liveQuote.dataUpdatedAt, liveQuote.updatedAt, current.dataUpdatedAt),
    updatedAt: firstText(liveQuote.updatedAt, current.updatedAt),
    source: firstText(liveQuote.source, current.source, "massive"),
    transport: firstText(liveQuote.transport, current.transport),
  };
};

const applyLiveEquityQuoteToRow = (row, liveQuote) => {
  if (!liveQuote) return row;
  const quote = mergeLiveEquityQuote(row.quote, liveQuote);
  const mark = firstPositiveFiniteNumber(
    quote?.mark,
    quote?.mid,
    quoteMid(quote),
    quote?.last,
    quote?.price,
    row.mark,
    row.marketPrice,
  );
  const quantity = firstFiniteNumber(row.quantity);
  const averageCost = firstFiniteNumber(row.averageCost, row.averagePrice);
  const perShareDayChange = firstFiniteNumber(
    quote?.dayChange,
    liveQuote.dayChange,
    liveQuote.chg,
    liveQuote.change,
    liveQuote.netChange,
  );
  const dayChangePercent = firstFiniteNumber(
    quote?.dayChangePercent,
    liveQuote.dayChangePercent,
    liveQuote.pct,
    liveQuote.changePercent,
    liveQuote.percentChange,
    row.dayChangePercent,
  );
  const marketValue =
    mark != null && quantity != null ? mark * quantity : row.marketValue;
  const unrealizedPnl =
    mark != null && averageCost != null && quantity != null
      ? (mark - averageCost) * quantity
      : row.unrealizedPnl;
  const costBasis =
    averageCost != null && quantity != null ? Math.abs(averageCost * quantity) : null;
  const unrealizedPnlPercent =
    unrealizedPnl != null && costBasis
      ? (unrealizedPnl / costBasis) * 100
      : row.unrealizedPnlPercent;
  const sameDayPosition = positionOpenedOnCurrentMarketDay(row.openedAt);
  const previousClose = firstPositiveFiniteNumber(
    quote?.prevClose,
    liveQuote.prevClose,
    row.underlyingMarket?.previousClose,
    row.previousClose,
  );
  const markDayChange =
    mark != null && previousClose != null ? mark - previousClose : null;
  // Day % must carry the same sign as Day $ (markDayChange * quantity) so a short
  // position whose underlying rises shows a loss in BOTH the $ and % of the same cell,
  // matching the signed same-day path (unrealizedPnlPercent) and the account-total Day %.
  const markDayChangePercent =
    markDayChange != null &&
    previousClose != null &&
    previousClose > 0 &&
    quantity != null &&
    quantity !== 0
      ? ((markDayChange * Math.sign(quantity)) / previousClose) * 100
      : null;
  const dayChange =
    sameDayPosition && unrealizedPnl != null
      ? unrealizedPnl
      : markDayChange != null && quantity != null
      ? markDayChange * quantity
      : perShareDayChange != null && quantity != null
      ? perShareDayChange * quantity
      : row.dayChange;
  const rowDayChangePercent =
    sameDayPosition && unrealizedPnlPercent != null
      ? unrealizedPnlPercent
      : markDayChangePercent != null
      ? markDayChangePercent
      : dayChangePercent;
  const underlyingMarket = {
    ...(row.underlyingMarket || {}),
    symbol: resolvePositionUnderlyingSymbol(row) || row.underlyingMarket?.symbol || row.symbol,
    price: firstPositiveFiniteNumber(liveQuote.price, liveQuote.mark, liveQuote.last, mark),
    bid: quote?.bid,
    ask: quote?.ask,
    mark,
    previousClose,
    updatedAt: firstText(liveQuote.dataUpdatedAt, liveQuote.updatedAt, row.underlyingMarket?.updatedAt),
    dataUpdatedAt: firstText(liveQuote.dataUpdatedAt, row.underlyingMarket?.dataUpdatedAt),
    source: firstText(liveQuote.source, row.underlyingMarket?.source, "massive"),
    transport: firstText(liveQuote.transport, row.underlyingMarket?.transport),
  };

  if (isOptionPosition(row)) {
    return {
      ...row,
      underlyingMarket,
    };
  }

  // Preserve the incoming broker (SnapTrade) money as the source of truth for the money
  // columns/totals; the live values above stay for the Price overlay only. Shadow-ledger
  // rows have no broker, so leave the broker fields null and let readers fall back to live
  // (Massive) valuation.
  const preserveBrokerMoney = !isShadowLedgerPositionRow(row);
  return {
    ...row,
    quote,
    mark,
    marketPrice: mark,
    dayChange,
    dayChangePercent: rowDayChangePercent,
    unrealizedPnl,
    unrealizedPnlPercent,
    marketValue,
    brokerMarketValue: preserveBrokerMoney
      ? firstFiniteNumber(row.brokerMarketValue ?? row.marketValue)
      : null,
    brokerUnrealizedPnl: preserveBrokerMoney
      ? firstFiniteNumber(row.brokerUnrealizedPnl ?? row.unrealizedPnl)
      : null,
    brokerUnrealizedPnlPercent: preserveBrokerMoney
      ? firstFiniteNumber(row.brokerUnrealizedPnlPercent ?? row.unrealizedPnlPercent)
      : null,
    underlyingMarket,
  };
};

const firstDisplayTotalNumber = (...values) => {
  for (const value of values) {
    if (value == null || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const buildDisplayTotals = (rows, fallbackTotals = {}) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeFallbackTotals = fallbackTotals || {};
  const fallbackCash = firstDisplayTotalNumber(
    safeFallbackTotals.cash,
    safeFallbackTotals.totalCash,
    safeFallbackTotals.totalCashValue,
  );
  const fallbackBuyingPower = firstDisplayTotalNumber(safeFallbackTotals.buyingPower);
  const fallbackNetLiquidation = firstDisplayTotalNumber(safeFallbackTotals.netLiquidation);
  if (!safeRows.length) {
    return {
      ...safeFallbackTotals,
      cash: fallbackCash,
      totalCash: fallbackCash,
      buyingPower: fallbackBuyingPower,
      netLiquidation: fallbackNetLiquidation,
    };
  }
  const totals = safeRows.reduce(
    (acc, row) => {
      const marketValue = brokerMarketValueForRow(row);
      const unrealizedPnl = brokerUnrealizedPnlForRow(row);
      const dayChange = firstFiniteNumber(row.dayChange);
      const weightPercent = firstFiniteNumber(row.weightPercent);
      if (marketValue != null) {
        acc.netExposure += marketValue;
        if (marketValue >= 0) acc.grossLong += marketValue;
        else acc.grossShort += marketValue;
      }
      if (unrealizedPnl != null) acc.unrealizedPnl += unrealizedPnl;
      if (dayChange != null) acc.dayChange += dayChange;
      if (weightPercent != null) {
        acc.weightPercent = (acc.weightPercent ?? 0) + weightPercent;
      }
      return acc;
    },
    {
      netExposure: 0,
      grossLong: 0,
      grossShort: 0,
      unrealizedPnl: 0,
      dayChange: 0,
      weightPercent: null,
      cash: fallbackCash,
      totalCash: fallbackCash,
      buyingPower: fallbackBuyingPower,
      netLiquidation: fallbackNetLiquidation,
    },
  );
  if (totals.netLiquidation == null && totals.cash != null) {
    totals.netLiquidation = totals.cash + totals.netExposure;
  }
  return totals;
};

const applyDisplayWeights = (rows, fallbackTotals = null) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const netLiquidation = firstDisplayTotalNumber(
    fallbackTotals?.netLiquidation,
    fallbackTotals?.netLiquidity,
    fallbackTotals?.accountValue,
  );
  if (netLiquidation == null || netLiquidation === 0) {
    return safeRows;
  }
  const base = Math.abs(netLiquidation);
  return safeRows.map((row) => {
    const marketValue = brokerMarketValueForRow(row);
    if (marketValue == null) return row;
    const weightPercent = (marketValue / base) * 100;
    return {
      ...row,
      weightPercent,
    };
  });
};

const formatQuoteMarkLast = (quote, maskValues) => {
  const mark = firstFiniteNumber(quote?.mark, quote?.mid);
  const last = firstFiniteNumber(quote?.last, quote?.price);
  if (mark == null && last == null) return MISSING_VALUE;
  return `Mark ${formatOptionPrice(mark, maskValues)} · Last ${formatOptionPrice(last, maskValues)}`;
};

const formatGreek = (label, value, digits = 2) => {
  const numeric = finiteNumber(value);
  return numeric == null ? null : `${label} ${numeric.toFixed(digits)}`;
};

const formatIv = (value) => {
  const numeric = finiteNumber(value);
  if (numeric == null) return null;
  const pct = Math.abs(numeric) <= 3 ? numeric * 100 : numeric;
  return `IV ${pct.toFixed(1)}%`;
};

const formatMetricCount = (value) => {
  const numeric = finiteNumber(value);
  if (numeric == null) return MISSING_VALUE;
  if (Math.abs(numeric) >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (Math.abs(numeric) >= 1_000) return `${(numeric / 1_000).toFixed(1)}K`;
  return formatNumber(numeric, 0);
};

const formatTimestampDetail = (value) => {
  const text = firstText(value);
  return text ? formatAppDateTime(text) : "";
};

const quoteFreshnessDetail = (quote) =>
  [
    firstText(quote?.quoteFreshness, quote?.freshness),
    firstText(quote?.marketDataMode),
    formatTimestampDetail(
      firstText(quote?.quoteUpdatedAt, quote?.dataUpdatedAt, quote?.updatedAt),
    ),
  ]
    .filter(Boolean)
    .join(" · ");

const formatReasonChip = (value) =>
  formatEnumLabel(value)
    .replace(/^Mtf\b/, "MTF")
    .replace(/\bAdx\b/, "ADX");

const formatAutomationStopDistanceLabel = (stopDistancePct, maskValues) => {
  const distance = firstFiniteNumber(stopDistancePct);
  if (distance == null) return null;
  const formatted = formatAccountPercent(Math.abs(distance), 1, maskValues);
  return distance <= 0 ? `${formatted} past stop` : `${formatted} from stop`;
};

const automationStopTone = (stopDistancePct) => {
  const distance = firstFiniteNumber(stopDistancePct);
  if (distance == null) return CSS_COLOR.textSec;
  if (distance <= 0) return CSS_COLOR.red;
  return distance <= 20 ? CSS_COLOR.amber : CSS_COLOR.textSec;
};

const automationPositionMetrics = (row, currency, maskValues) => {
  const automation = row?.automationContext || null;
  if (!automation) return null;

  const mark = firstFiniteNumber(row?.mark);
  const stop = firstFiniteNumber(automation.stopPrice);
  const peak = firstFiniteNumber(automation.peakPrice);
  const entry = firstFiniteNumber(automation.entryPrice, row?.averageCost);
  const signalScore = firstFiniteNumber(automation.signalScore);
  const barsSinceSignal = firstFiniteNumber(automation.barsSinceSignal);
  const barsSinceSignalLabel =
    barsSinceSignal != null ? `${Math.round(barsSinceSignal)} bars since signal` : null;
  const stopDistancePct =
    mark != null && stop != null && mark !== 0 ? ((mark - stop) / Math.abs(mark)) * 100 : null;
  const stopDistanceLabel = formatAutomationStopDistanceLabel(stopDistancePct, maskValues);
  const stopTone = automationStopTone(stopDistancePct);
  const givebackPct =
    mark != null && peak != null && peak > 0 ? ((mark - peak) / peak) * 100 : null;
  const returnPct =
    mark != null && entry != null && entry > 0 ? ((mark - entry) / entry) * 100 : null;
  const purchasedAt = firstText(automation.purchasedAt, automation.openedAt, automation.signalAt);
  const signalAt = firstText(automation.signalAt);
  const reasons = Array.isArray(automation.signalReasons)
    ? automation.signalReasons.slice(0, 3).map(formatReasonChip)
    : [];
  const signalMain = [
    signalScore != null ? `${signalScore.toFixed(1)} score` : null,
    automation.signalTier ? formatEnumLabel(automation.signalTier) : null,
    automation.timeframe,
  ].filter(Boolean).join(" · ") || MISSING_VALUE;
  const signalDetail = [
    barsSinceSignalLabel,
    signalAt ? `signal ${formatRelativeTimeShort(signalAt)}` : null,
    purchasedAt ? `bought ${formatRelativeTimeShort(purchasedAt)}` : null,
  ].filter(Boolean).join(" · ");
  const riskMain = [
    stopDistanceLabel,
    automation.premiumAtRisk != null
      ? `risk ${formatAccountMoney(automation.premiumAtRisk, currency, true, maskValues)}`
      : null,
  ].filter(Boolean).join(" · ") || MISSING_VALUE;
  const riskDetail = [
    returnPct != null ? `return ${formatAccountPercent(returnPct, 1, maskValues)}` : null,
    givebackPct != null ? `giveback ${formatAccountPercent(givebackPct, 1, maskValues)}` : null,
    automation.lastMarkedAt ? `marked ${formatRelativeTimeShort(automation.lastMarkedAt)}` : null,
  ].filter(Boolean).join(" · ");
  const tableDetail = [
    stopDistanceLabel,
    barsSinceSignalLabel,
    purchasedAt ? `bought ${formatRelativeTimeShort(purchasedAt)}` : null,
    automation.premiumAtRisk != null
      ? `risk ${formatAccountMoney(automation.premiumAtRisk, currency, true, maskValues)}`
      : null,
  ].filter(Boolean).join(" · ");
  const mobileSummary = [
    signalScore != null ? `${signalScore.toFixed(1)} score` : null,
    barsSinceSignalLabel,
    stopDistanceLabel,
  ].filter(Boolean).join(" · ");

  return {
    signalMain,
    signalDetail,
    riskMain,
    riskDetail,
    tableDetail,
    mobileSummary,
    reasons,
    purchasedAt,
    signalAt,
    stopDistancePct,
    stopDistanceLabel,
    stopTone,
    givebackPct,
    returnPct,
  };
};

const tradeManagementForRow = (row) => buildPositionTradeManagement(row);

const formatTradeManagementSource = (source) =>
  source === "broker"
    ? "Broker"
    : source === "automation"
      ? "Auto"
      : source === "local"
        ? "Local"
        : "";

const tradeManagementTone = (management) => {
  if (management.status === "breached") return CSS_COLOR.red;
  if (
    management.riskDistancePct != null &&
    management.riskDistancePct <= 10
  ) {
    return CSS_COLOR.amber;
  }
  return CSS_COLOR.textSec;
};

const tradeManagementDistanceTone = (management) =>
  management.status === "breached"
    ? CSS_COLOR.red
    : management.riskDistancePct != null && management.riskDistancePct <= 10
      ? CSS_COLOR.amber
      : CSS_COLOR.textDim;

const formatTradeManagementPrice = (level, maskValues) =>
  level?.price != null ? formatAccountPrice(level.price, 2, maskValues) : MISSING_VALUE;

const formatTradeManagementDistance = (management, maskValues) => {
  const distance = firstFiniteNumber(management?.riskDistancePct);
  if (distance == null) return MISSING_VALUE;
  const formatted = formatAccountPercent(Math.abs(distance), 1, maskValues);
  return distance <= 0 ? `${formatted} past` : `${formatted} away`;
};

const formatTradeManagementDistanceBadge = (management, maskValues) => {
  const distance = firstFiniteNumber(management?.riskDistancePct);
  if (distance == null) return MISSING_VALUE;
  const formatted = formatAccountPercent(Math.abs(distance), 1, maskValues);
  return maskValues ? formatted : `${distance <= 0 ? "-" : "+"}${formatted}`;
};

const tradeManagementStopSubtext = (management, maskValues) => {
  if (!management.stop) return management.statusLabel;
  if (management.trail) return "Hard";
  return formatTradeManagementDistanceBadge(management, maskValues);
};

const tradeManagementTrailSubtext = (management, maskValues) => {
  if (!management.trail) return "Inactive";
  return formatTradeManagementDistanceBadge(management, maskValues);
};

const tradeManagementTitle = (management, currency, maskValues) => {
  const parts = [
    management.stop
      ? `${management.trail ? "Hard stop" : "Stop"} ${formatTradeManagementPrice(management.stop, maskValues)} ${formatTradeManagementSource(management.stop.source)}`
      : null,
    management.trail
      ? `Trail ${formatTradeManagementPrice(management.trail, maskValues)} ${formatTradeManagementSource(management.trail.source)}`
      : null,
    management.riskDistancePct != null
      ? `Distance ${formatTradeManagementDistance(management, maskValues)}`
      : null,
    management.riskAmount != null
      ? `Risk ${formatAccountMoney(management.riskAmount, currency, true, maskValues)}`
      : null,
    management.statusLabel,
  ].filter(Boolean);
  return parts.join(" · ");
};

const hasTradeManagementDetail = (row) => {
  const management = tradeManagementForRow(row);
  return Boolean(management.stop || management.trail);
};

const optionInlineDetail = (row, maskValues) => {
  const contract = row?.optionContract || null;
  if (!contract) {
    return [
      row?.description || row?.assetClass || "Position",
      row?.sector || null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const quoteBidAsk = formatQuoteBidAsk(optionDisplayQuote(row), maskValues);
  const underlying = row?.underlyingMarket || null;
  const underlyingPrice = firstPositiveFiniteNumber(underlying?.price);
  const underlyingBid = firstPositiveFiniteNumber(underlying?.bid);
  const underlyingAsk = firstPositiveFiniteNumber(underlying?.ask);
  const underlyingSymbol = firstDisplayText(underlying?.symbol, contract?.underlying, row?.symbol);
  const underlyingMarket =
    underlyingPrice != null && underlyingSymbol
      ? `${underlyingSymbol} ${formatAccountPrice(underlyingPrice, 2, maskValues)}`
      : null;
  const underlyingBidAsk =
    underlyingBid != null && underlyingAsk != null
      ? `U bid/ask ${formatOptionPrice(underlyingBid, maskValues)} / ${formatOptionPrice(underlyingAsk, maskValues)}`
      : null;

  return [
    optionContractTermsLabel(contract),
    quoteBidAsk !== MISSING_VALUE ? `Opt ${quoteBidAsk}` : null,
    underlyingMarket || null,
    underlyingBidAsk,
  ]
    .filter(Boolean)
    .join(" · ");
};

const optionDetailMetrics = (row, currency, maskValues) => {
  const contract = row?.optionContract || null;
  const quote = contract ? optionDisplayQuote(row) : null;
  const greeksQuote = row?.optionQuote || quote;
  const underlying = row?.underlyingMarket || null;
  const automation = row?.automationContext || null;
  const automationMetrics = automationPositionMetrics(row, currency, maskValues);
  const management = tradeManagementForRow(row);
  if (!contract && !quote && !underlying && !automation && !hasTradeManagementDetail(row)) return [];

  const greeksMain = [
    formatGreek("Δ", greeksQuote?.delta, 2),
    formatIv(greeksQuote?.impliedVolatility),
  ].filter(Boolean);
  const greeksDetail = [
    formatGreek("Γ", greeksQuote?.gamma, 3),
    formatGreek("θ", greeksQuote?.theta, 3),
    formatGreek("V", greeksQuote?.vega, 3),
  ].filter(Boolean);
  const openInterest = formatMetricCount(greeksQuote?.openInterest);
  const volume = formatMetricCount(greeksQuote?.volume);
  const underlyingPrice = firstPositiveFiniteNumber(underlying?.price);
  const underlyingBid = firstPositiveFiniteNumber(underlying?.bid);
  const underlyingAsk = firstPositiveFiniteNumber(underlying?.ask);

  return [
    contract
      ? {
          label: "Contract",
          value: optionContractTermsLabel(contract),
          detail: [
            contract?.providerContractId ? `conid ${contract.providerContractId}` : null,
            contract?.multiplier ? `x${formatNumber(contract.multiplier, 0)}` : null,
          ].filter(Boolean).join(" · "),
        }
      : null,
    quote
      ? {
          label: "Bid / Ask",
          value: formatQuoteBidAsk(quote, maskValues),
          detail: quoteFreshnessDetail(quote),
        }
      : null,
    quote
      ? {
          label: "Mark / Last",
          value: formatQuoteMarkLast(quote, maskValues),
          detail: quote?.spreadPctOfMid != null
            ? `Spread ${formatAccountPercent(quote.spreadPctOfMid, 2, maskValues)}`
            : quote?.spreadCents != null
              ? `Spread ${formatNumber(quote.spreadCents, 0)}c`
              : "",
        }
      : null,
    quote
      ? {
          label: "Greeks",
          value: greeksMain.join(" · ") || MISSING_VALUE,
          detail: greeksDetail.join(" · "),
        }
      : null,
    quote
      ? {
          label: "OI / Vol",
          value: `OI ${openInterest} · Vol ${volume}`,
          detail: "",
        }
      : null,
    underlying
      ? {
          label: "Underlying",
          value: [
            underlying?.symbol,
            underlyingPrice != null ? formatAccountPrice(underlyingPrice, 2, maskValues) : null,
          ].filter(Boolean).join(" ") || MISSING_VALUE,
          detail:
            underlyingBid != null && underlyingAsk != null
              ? `Bid / ask ${formatOptionPrice(underlyingBid, maskValues)} / ${formatOptionPrice(underlyingAsk, maskValues)}`
              : firstText(underlying?.updatedAt),
        }
      : null,
    management.stop || management.trail
      ? {
          label: "Trade Management",
          value: [
            management.stop
              ? `Stop ${formatTradeManagementPrice(management.stop, maskValues)}`
              : null,
            management.trail
              ? `Trail ${formatTradeManagementPrice(management.trail, maskValues)}`
              : null,
          ].filter(Boolean).join(" · ") || MISSING_VALUE,
          detail: tradeManagementTitle(management, currency, maskValues),
        }
      : null,
    automation
      ? {
          label: "Entry Signal",
          value: automationMetrics?.signalMain || MISSING_VALUE,
          detail: [
            automationMetrics?.signalDetail,
            automationMetrics?.reasons?.length
              ? automationMetrics.reasons.join(" · ")
              : null,
            automation?.signalAt
              ? `Signal ${formatTimestampDetail(automation.signalAt)}`
              : null,
          ].filter(Boolean).join(" · "),
        }
      : null,
    automation
      ? {
          label: "Purchased",
          value: firstText(automation?.purchasedAt, automation?.openedAt)
            ? formatTimestampDetail(firstText(automation?.purchasedAt, automation?.openedAt))
            : MISSING_VALUE,
          detail: [
            automation?.purchasedAt ? `${formatRelativeTimeShort(automation.purchasedAt)} ago` : null,
            automation?.openedAt && automation?.openedAt !== automation?.purchasedAt
              ? `Opened ${formatTimestampDetail(automation.openedAt)}`
              : null,
          ].filter(Boolean).join(" · "),
        }
      : null,
    automation
      ? {
          label: "Exit / Risk",
          value: [
            automation?.stopPrice != null
              ? `Stop ${formatAccountPrice(automation.stopPrice, 2, maskValues)}`
              : null,
            automation?.premiumAtRisk != null
              ? `Risk ${formatAccountMoney(automation.premiumAtRisk, currency, true, maskValues)}`
              : null,
          ].filter(Boolean).join(" · ") || MISSING_VALUE,
          detail: [
            automationMetrics?.riskMain !== MISSING_VALUE
              ? automationMetrics?.riskMain
              : null,
            automation?.peakPrice != null
              ? `Peak ${formatAccountPrice(automation.peakPrice, 2, maskValues)}`
              : null,
            automationMetrics?.riskDetail,
            automation?.timeframe,
            automation?.lastMarkedAt
              ? `Marked ${formatTimestampDetail(automation.lastMarkedAt)}`
              : null,
          ].filter(Boolean).join(" · "),
        }
      : null,
  ].filter(Boolean);
};

export {
  PositionOptionQuoteStreams,
  buildPositionOptionQuoteGroups,
} from "./PositionOptionQuoteStreams.jsx";

export const useLiveOptionPositionRows = ({
  rows: inputRows = [],
  enabled = true,
  totals = null,
  marketDataOwner = "positions:live-rows",
  registerMarketDataSymbols = true,
  equitySnapshotsBySymbol = null,
} = {}) => {
  const positionUnderlyingSymbols = useMemo(
    () =>
      Array.from(
        new Set(inputRows.map(resolvePositionUnderlyingSymbol).filter(Boolean)),
      ),
    [inputRows],
  );
  useRegisterPositionMarketDataSymbols(
    marketDataOwner,
    positionUnderlyingSymbols,
    Boolean(enabled && registerMarketDataSymbols),
  );
  const runtimeEquitySnapshotsBySymbol = useRuntimeTickerSnapshots(
    registerMarketDataSymbols ? positionUnderlyingSymbols : [],
  );
  const positionQuoteSnapshotsBySymbol = usePositionQuoteSnapshots(
    registerMarketDataSymbols ? positionUnderlyingSymbols : [],
  );
  const liveEquitySnapshotsBySymbol = useMemo(
    () =>
      equitySnapshotsBySymbol || {
        ...runtimeEquitySnapshotsBySymbol,
        ...positionQuoteSnapshotsBySymbol,
      },
    [
      equitySnapshotsBySymbol,
      runtimeEquitySnapshotsBySymbol,
      positionQuoteSnapshotsBySymbol,
    ],
  );
  const optionQuoteGroups = useMemo(
    () => buildPositionOptionQuoteGroups(inputRows),
    [inputRows],
  );
  const providerContractIds = useMemo(
    () =>
      Array.from(
        new Set(
          optionQuoteGroups.flatMap((group) => group.providerContractIds),
        ),
      ),
    [optionQuoteGroups],
  );
  const quoteVersion = useStoredOptionQuoteSnapshotVersion(
    enabled ? providerContractIds : [],
  );
  const rows = useMemo(() => {
    if (!enabled) {
      return applyDisplayWeights(inputRows, totals);
    }
    const liveQuoteByProviderContractId = providerContractIds.length
      ? Object.fromEntries(
          providerContractIds.map((providerContractId) => [
            providerContractId,
            getStoredOptionQuoteSnapshot(providerContractId),
          ]),
        )
      : {};
    return applyDisplayWeights(
      inputRows.map((row) => {
        const optionPatchedRow = applyFreshestLiveOptionQuoteToRow(
          row,
          liveQuoteByProviderContractId,
        );
        const symbol = resolvePositionUnderlyingSymbol(optionPatchedRow);
        return applyLiveEquityQuoteToRow(
          optionPatchedRow,
          symbol ? liveEquitySnapshotsBySymbol?.[symbol] : null,
        );
      }),
      totals,
    );
  }, [
    enabled,
    liveEquitySnapshotsBySymbol,
    inputRows,
    providerContractIds,
    totals,
    quoteVersion,
  ]);
  const displayTotals = useMemo(
    () => buildDisplayTotals(rows, totals),
    [rows, totals],
  );

  return {
    rows,
    displayTotals,
    optionQuoteGroups,
    providerContractIds,
    positionUnderlyingSymbols,
    underlyingSnapshotsBySymbol: liveEquitySnapshotsBySymbol,
  };
};

export const __positionsPanelInternalsForTests = {
  applyDisplayWeights,
  applyLiveEquityQuoteToRow,
  applyFreshestLiveOptionQuoteToRow,
  applyLiveOptionQuoteToRow,
  automationPositionMetrics,
  automationStopTone,
  buildDisplayTotals,
  formatAutomationStopDistanceLabel,
  optionDetailMetrics,
  optionInlineDetail,
  positionOpenedOnCurrentMarketDay,
};

const resolvePositionUnderlyingPrice = (row, snapshotsBySymbol = {}) => {
  const symbol = resolvePositionUnderlyingSymbol(row);
  const snapshot = symbol ? snapshotsBySymbol?.[symbol] : null;
  const staticUnderlying = row?.underlyingMarket || null;
  const equityFallback = !isOptionPosition(row)
    ? firstPositiveFiniteNumber(row?.mark, row?.marketPrice)
    : null;
  return firstPositiveFiniteNumber(
    snapshot?.price,
    snapshot?.mark,
    snapshot?.last,
    quoteMid(snapshot),
    staticUnderlying?.price,
    staticUnderlying?.mark,
    quoteMid(staticUnderlying),
    row?.optionQuote?.underlyingPrice,
    row?.quote?.underlyingPrice,
    equityFallback,
  );
};

const positionUnderlyingPriceTitle = (row, snapshotsBySymbol, maskValues) => {
  const symbol = resolvePositionUnderlyingSymbol(row);
  const snapshot = symbol ? snapshotsBySymbol?.[symbol] : null;
  const price = resolvePositionUnderlyingPrice(row, snapshotsBySymbol);
  const updatedAt = firstText(
    snapshot?.dataUpdatedAt,
    snapshot?.updatedAt,
    row?.underlyingMarket?.updatedAt,
    row?.optionQuote?.dataUpdatedAt,
    row?.optionQuote?.updatedAt,
  );
  return [
    "Underlying spot",
    price != null ? formatAccountPrice(price, 2, maskValues) : null,
    updatedAt ? formatRelativeTimeShort(updatedAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

const buildPositionFallbackSparklineData = (row, snapshot, symbol) => {
  const current = firstPositiveFiniteNumber(
    snapshot?.price,
    snapshot?.mark,
    row?.underlyingMarket?.price,
    row?.underlyingMarket?.mark,
    row?.mark,
    row?.marketPrice,
  );
  if (current == null) return [];

  const percent = firstFiniteNumber(
    row?.dayChangePercent,
    snapshot?.pct,
    snapshot?.changePercent,
    row?.unrealizedPnlPercent,
  );
  const previous = firstPositiveFiniteNumber(
    row?.underlyingMarket?.previousClose,
    row?.previousClose,
  );
  const start =
    percent != null && percent > -99
      ? current / (1 + percent / 100)
      : previous ?? current * 0.9975;

  return buildDetailedFallbackSparklineData({
    symbol,
    current,
    previous: start,
    pointCount: SPARKLINE_RENDER_POINT_LIMIT,
  });
};

const resolvePositionSparklineData = (snapshot, row, symbol) => {
  if (Array.isArray(snapshot?.sparkBars) && snapshot.sparkBars.length >= 2) {
    return snapshot.sparkBars;
  }
  if (Array.isArray(snapshot?.spark) && snapshot.spark.length >= 2) {
    return snapshot.spark;
  }
  return buildPositionFallbackSparklineData(row, snapshot, symbol);
};

const resolvePositionSparklinePositive = (row, snapshot) => {
  const percent = firstFiniteNumber(
    row?.dayChangePercent,
    snapshot?.pct,
    snapshot?.changePercent,
  );
  if (percent != null) return percent >= 0;

  const change = firstFiniteNumber(row?.dayChange, snapshot?.chg, snapshot?.change);
  if (change != null) return change >= 0;

  return null;
};

const mobileFilterRailStyle = {
  display: "flex",
  gap: sp(4),
  flexWrap: "nowrap",
  overflowX: "auto",
  minWidth: 0,
  maxWidth: "100%",
  paddingBottom: sp(1),
  WebkitOverflowScrolling: "touch",
};

const positionFilterGroupStyle = (isPhone) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: sp(5),
  minWidth: 0,
  flex: isPhone ? "0 0 auto" : "0 1 auto",
  padding: sp("2px 4px"),
  border: `1px solid ${CSS_COLOR.borderLight}`,
  borderRadius: dim(RADII.sm),
  background: cssColorMix(CSS_COLOR.text, 2),
});

const PositionFilterGroup = ({ label, children, isPhone }) => (
  <div style={positionFilterGroupStyle(isPhone)}>
    <span
      style={{
        color: CSS_COLOR.textMuted,
        fontFamily: T.sans,
        fontSize: textSize("caption"),
        fontWeight: FONT_WEIGHTS.label,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
    {children}
  </div>
);

const positionSparklineShellStyle = (compact = false, inline = false) => ({
  display: inline ? "inline-flex" : "block",
  alignItems: inline ? "center" : undefined,
  width: dim(compact ? TABLE_SPARKLINE_COMPACT_WIDTH : TABLE_SPARKLINE_WIDTH),
  height: dim(compact ? TABLE_SPARKLINE_COMPACT_HEIGHT : TABLE_SPARKLINE_HEIGHT),
  marginTop: inline ? 0 : sp(compact ? 2 : 3),
  flexShrink: inline ? 0 : undefined,
  overflow: "hidden",
  opacity: 0.95,
});

const PositionTrendSparkline = ({
  row,
  snapshotsBySymbol,
  compact = false,
  inline = false,
}) => {
  const symbol = resolvePositionSparklineSymbol(row);
  const snapshot = symbol ? snapshotsBySymbol?.[symbol] : null;
  const data = resolvePositionSparklineData(snapshot, row, symbol);
  if (data.length < 2) return null;

  return (
    <AppTooltip content={`${symbol} intraday trend`}>
      <span
        data-testid="account-position-sparkline"
        style={positionSparklineShellStyle(compact, inline)}
      >
        <MicroSparkline
          data={data}
          positive={resolvePositionSparklinePositive(row, snapshot)}
          width={compact ? TABLE_SPARKLINE_COMPACT_WIDTH : TABLE_SPARKLINE_WIDTH}
        height={compact ? TABLE_SPARKLINE_COMPACT_HEIGHT : TABLE_SPARKLINE_HEIGHT}
        style={{ width: "100%", height: "100%" }}
        ariaHidden
        />
      </span>
    </AppTooltip>
  );
};

const positionDisplayForRow = (row) => buildPositionDisplayModel(row, row?.optionQuote);

const quoteSourceLabel = (quote) =>
  quote?.source ? formatEnumLabel(quote.source) : null;

const formatQuoteStateLabel = (value) => {
  const state = firstText(value);
  return state ? formatEnumLabel(state) : null;
};

const formatQuoteReasonLabel = (value) => {
  const reason = firstText(value);
  return reason ? formatEnumLabel(reason) : null;
};

const optionGreeksStatusLabel = (quote) => {
  if (
    firstFiniteNumber(
      quote?.delta,
      quote?.gamma,
      quote?.theta,
      quote?.vega,
    ) != null
  ) {
    return "";
  }
  const greeksStatus = firstText(quote?.greeksStatus, quote?.greeksFreshness).toLowerCase();
  const greeksReason = firstText(quote?.greeksReason).toLowerCase();
  if (greeksReason === "awaiting_greeks" || greeksStatus === "pending") {
    return "Greeks pending";
  }
  if (greeksStatus === "stale") {
    return "Greeks stale";
  }
  if (greeksStatus === "unavailable" || greeksStatus === "rejected") {
    return "Greeks unavailable";
  }
  return "";
};

const formatQuoteUpdatedDetail = (quote) => {
  const quoteStatus = firstText(quote?.quoteStatus, quote?.status);
  const quoteReason = firstText(
    quote?.quoteReason,
    quote?.reason,
    quote?.unavailableDetail,
  );
  const quoteState =
    quoteStatus && quoteStatus !== "live"
      ? [
          formatQuoteStateLabel(quoteStatus),
          formatQuoteReasonLabel(quoteReason),
        ].filter(Boolean).join(": ")
      : null;
  return [
    formatPositionQuoteFreshnessLabel(quote),
    quoteState,
    quoteSourceLabel(quote),
    quote?.marketDataMode ? formatEnumLabel(quote.marketDataMode) : null,
  ]
    .filter(Boolean)
    .join(" · ");
};

const formatPositionBidAskPair = (quote, maskValues) => {
  const formatSide = (value) =>
    value == null ? MISSING_VALUE : formatAccountPrice(value, 2, maskValues);
  return `${formatSide(quote?.bid)} / ${formatSide(quote?.ask)}`;
};

const hasPositionBidAsk = (quote) => quote?.bid != null && quote?.ask != null;

const PositionOpenedCell = ({ row }) => {
  const display = positionDisplayForRow(row);
  const detail = [display.ageLabel, display.openedSourceLabel]
    .filter(Boolean)
    .join(" · ");
  return (
    <td style={{ ...tableCellStyle, minWidth: dim(86) }}>
      <div style={{ color: display.openedLabel ? CSS_COLOR.text : CSS_COLOR.textDim, fontFamily: T.data }}>
        {display.openedLabel || MISSING_VALUE}
      </div>
      <div style={cellSubTextStyle(CSS_COLOR.textDim)}>{detail || "open date unavailable"}</div>
    </td>
  );
};

const PositionQuoteCell = ({ row, maskValues }) => {
  const display = positionDisplayForRow(row);
  const quote = display.quote;
  const bidAsk = formatPositionBidAskPair(quote, maskValues);
  const quoteHasBidAsk = hasPositionBidAsk(quote);
  const spread = formatPositionSpreadLabel(quote, (value) =>
    formatAccountPercent(value, 1, maskValues),
  );
  const detail = [spread, formatQuoteUpdatedDetail(quote)].filter(Boolean).join(" · ");
  const explicitQuoteStatus = firstText(quote?.quoteStatus, quote?.status);
  const explicitQuoteReason = firstText(
    quote?.quoteReason,
    quote?.reason,
    quote?.unavailableDetail,
  );
  const quoteIssues = collectQuoteDataIssues(
    {
      ...(quote || {}),
      freshness: quote?.quoteFreshness ?? quote?.freshness,
      status: quoteHasBidAsk
        ? explicitQuoteStatus || quote?.status
        : quote?.mark != null
          ? explicitQuoteStatus || "metadata"
          : explicitQuoteStatus || "unavailable",
      reason: explicitQuoteReason || quote?.reason,
      unavailableDetail: quoteHasBidAsk
        ? explicitQuoteReason || null
        : quote?.mark != null
          ? explicitQuoteReason || "Only a mark is available; bid and ask are missing."
          : explicitQuoteReason || "Bid, ask, and mark are unavailable.",
    },
    {
      valueLabel: `${row?.symbol || row?.underlyingSymbol || "Position"} quote`,
      source: "account positions",
      nextAction:
        "Check the broker quote stream or refresh positions before relying on this valuation.",
    },
  );
  return (
    <td style={{ ...tableCellStyle, textAlign: "right", minWidth: dim(104) }}>
      <div style={{ color: quoteHasBidAsk ? CSS_COLOR.text : CSS_COLOR.textDim, fontFamily: T.data }}>
        {bidAsk}
      </div>
      <div
        style={{
          ...cellSubTextStyle(CSS_COLOR.textDim),
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: sp(4),
          maxWidth: "100%",
        }}
      >
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {detail || (quote?.mark != null ? "mark only" : "quote unavailable")}
        </span>
        <DataIssueInlineIcon issues={quoteIssues} side="left" align="center" />
      </div>
    </td>
  );
};

const StackedMetricCell = ({
  primary,
  secondary,
  primaryTone = CSS_COLOR.text,
  secondaryTone = CSS_COLOR.textDim,
  align = "right",
  minWidth = 88,
}) => (
  <td style={{ ...tableCellStyle, textAlign: align, minWidth: dim(minWidth) }}>
    <div style={{ color: primaryTone, fontFamily: T.data }}>{primary}</div>
    <div style={cellSubTextStyle(secondaryTone)}>{secondary}</div>
  </td>
);

const PositionSignalRiskCell = ({ row, currency, maskValues }) => {
  const metrics = automationPositionMetrics(row, currency, maskValues);
  if (!metrics) {
    return (
      <td style={{ ...tableCellStyle, color: CSS_COLOR.textDim, minWidth: dim(132) }}>
        {MISSING_VALUE}
      </td>
    );
  }
  return (
    <td style={{ ...tableCellStyle, minWidth: dim(174), maxWidth: dim(224) }}>
      <AppTooltip
        content={[
          metrics.signalMain,
          metrics.signalDetail,
          metrics.riskMain,
          metrics.riskDetail,
        ].filter((item) => item && item !== MISSING_VALUE).join(" · ")}
      >
        <div
          style={{
            color: CSS_COLOR.textSec,
            fontFamily: T.data,
            fontSize: textSize("body"),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {metrics.signalMain}
        </div>
      </AppTooltip>
      <div
        style={{
          marginTop: sp(1),
          color: metrics.stopTone,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {metrics.tableDetail || MISSING_VALUE}
      </div>
    </td>
  );
};

const POSITION_TABLE_ROW_HEIGHT = 34;
const POSITION_TABLE_HEADER_HEIGHT = 24;

const denseTableBorder = () => `1px solid ${CSS_COLOR.borderLight}`;
const denseTableDivider = () => `1px solid ${CSS_COLOR.border}`;

const denseColumnBoundaryStyle = (column = {}) => ({
  borderLeft: column.groupEdge === "start" ? denseTableDivider() : undefined,
  borderRight:
    column.groupEdge === "end" ? denseTableDivider() : denseTableBorder(),
  boxSizing: "border-box",
});

const denseTableColumnWidth = (column) => {
  const width = Number.parseFloat(String(column?.minWidth ?? column?.width ?? ""));
  return Number.isFinite(width) ? width : 0;
};

const denseTableMinWidth = (columns) =>
  columns.reduce((sum, column) => sum + denseTableColumnWidth(column), 0);

const denseTableColumnStyle = (column) => ({
  width: column.width,
  minWidth: column.minWidth || column.width,
});

const denseVisualAlign = (align = "right") => (align === "right" ? "center" : align);

const denseCellPadding = (column = {}) =>
  column.id === "actions" ? sp("1px 1px") : sp("1px 2px");

const denseColumnTextStyle = ({
  align = "right",
  color = CSS_COLOR.textSec,
  fontFamily = T.data,
  fontSize = textSize("body"),
  fontWeight = FONT_WEIGHTS.regular,
} = {}) => ({
  color,
  fontFamily,
  fontSize,
  fontWeight,
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.12,
  textAlign: denseVisualAlign(align),
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
});

const denseColumnSubTextStyle = ({
  align = "right",
  color = CSS_COLOR.textDim,
  fontFamily = T.sans,
} = {}) => ({
  ...denseColumnTextStyle({
    align,
    color,
    fontFamily,
    fontSize: textSize("caption"),
    fontWeight: FONT_WEIGHTS.regular,
  }),
  marginTop: sp(1),
});

const DenseStackedValue = ({
  primary,
  secondary,
  primaryTone = CSS_COLOR.textSec,
  secondaryTone = CSS_COLOR.textDim,
  align = "right",
  title,
}) => (
  <AppTooltip content={title}>
    <span
      style={{
        display: "grid",
        gap: sp(1),
        minWidth: 0,
        maxWidth: "100%",
        overflow: "hidden",
      }}
    >
      <span style={denseColumnTextStyle({ align, color: primaryTone })}>
        {primary || MISSING_VALUE}
      </span>
      {secondary ? (
        <span style={denseColumnSubTextStyle({ align, color: secondaryTone })}>
          {secondary}
        </span>
      ) : null}
    </span>
  </AppTooltip>
);

const compactGreekNumber = (value, digits = 2) => {
  const numeric = finiteNumber(value);
  if (numeric == null) return null;
  return numeric
    .toFixed(digits)
    .replace(/^(-?)0\./, "$1.");
};

const DenseGreekCell = ({ row, title }) => {
  const quote = row?.optionQuote || row?.quote || null;
  const delta = compactGreekNumber(quote?.delta, 2);
  const theta = compactGreekNumber(quote?.theta, 2);
  const greeksStatus = optionGreeksStatusLabel(quote);
  if (!delta && !theta) {
    const content = greeksStatus || MISSING_VALUE;
    const tooltip = [
      title,
      greeksStatus,
      formatQuoteReasonLabel(quote?.greeksReason),
    ].filter(Boolean).join(" · ");
    return tooltip ? (
      <AppTooltip content={tooltip}>
        <span style={denseColumnTextStyle({ color: CSS_COLOR.textDim })}>
          {content}
        </span>
      </AppTooltip>
    ) : (
      <span style={denseColumnTextStyle({ color: CSS_COLOR.textDim })}>
        {content}
      </span>
    );
  }
  return (
    <AppTooltip content={title}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: sp(3),
          width: "100%",
          minWidth: 0,
          overflow: "hidden",
          color: CSS_COLOR.textSec,
          fontFamily: T.data,
          fontSize: textSize("caption"),
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {delta ? <span aria-label={`Delta ${delta}`}>Δ{delta}</span> : null}
        {theta ? <span aria-label={`Theta ${theta}`}>θ{theta}</span> : null}
      </span>
    </AppTooltip>
  );
};

const denseTableCellStyle = (column, expanded = false) => ({
  padding: denseCellPadding(column),
  borderBottom: denseTableBorder(),
  height: dim(POSITION_TABLE_ROW_HEIGHT),
  verticalAlign: "middle",
  textAlign: denseVisualAlign(column.align),
  minWidth: column.minWidth || column.width,
  ...denseColumnBoundaryStyle(column),
  background: column.sticky ? CSS_COLOR.bg1 : "transparent",
  position: column.sticky ? "sticky" : undefined,
  left: column.sticky ? 0 : undefined,
  zIndex: column.sticky ? 2 : undefined,
  boxShadow: column.sticky
    ? `${expanded ? `inset 1px 0 0 ${CSS_COLOR.accent}, ` : ""}2px 0 0 ${CSS_COLOR.borderLight}`
    : "none",
});

const denseHeaderCellStyle = (column, active) => ({
  ...tableHeaderStyle,
  padding: denseCellPadding(column),
  height: dim(POSITION_TABLE_HEADER_HEIGHT),
  color: active ? CSS_COLOR.text : CSS_COLOR.textMuted,
  fontSize: textSize("caption"),
  letterSpacing: 0,
  textTransform: "none",
  textAlign: denseVisualAlign(column.align),
  minWidth: column.minWidth || column.width,
  background: CSS_COLOR.bg1,
  ...denseColumnBoundaryStyle(column),
  position: "sticky",
  top: 0,
  left: column.sticky ? 0 : undefined,
  zIndex: column.sticky ? 4 : 3,
  boxShadow: column.sticky ? `2px 0 0 ${CSS_COLOR.borderLight}` : undefined,
});

const compactPositionHeaderStyle = ({ align = "left" } = {}) => ({
  ...tableCellStyle,
  ...tableHeaderStyle,
  padding: sp("2px 4px"),
  height: dim(POSITION_TABLE_HEADER_HEIGHT),
  color: CSS_COLOR.textMuted,
  fontSize: textSize("caption"),
  letterSpacing: 0,
  textTransform: "none",
  textAlign: align,
  verticalAlign: "middle",
  borderRight: denseTableBorder(),
  boxSizing: "border-box",
});

const compactPositionCellStyle = ({
  align = "left",
  color = CSS_COLOR.textSec,
  fontFamily = T.sans,
} = {}) => ({
  ...tableCellStyle,
  padding: sp("2px 4px"),
  height: dim(32),
  color,
  fontFamily,
  textAlign: align,
  verticalAlign: "middle",
  borderRight: denseTableBorder(),
  boxSizing: "border-box",
});

const denseActionButtonStyle = {
  width: dim(22),
  height: dim(22),
  border: "none",
  borderRadius: dim(RADII.xs),
  background: CSS_COLOR.bg0,
  color: CSS_COLOR.textSec,
  display: "inline-grid",
  placeItems: "center",
  cursor: "pointer",
  padding: 0,
};

const signedPercent = (value, digits = 2, maskValues = false) => {
  if (maskValues) return formatAccountPercent(value, digits, true);
  const numeric = finiteNumber(value);
  if (numeric == null) return MISSING_VALUE;
  return `${numeric > 0 ? "+" : ""}${formatAccountPercent(numeric, digits, false)}`;
};

const denseDisplayQuote = (row) => positionDisplayForRow(row).quote;

const hasExpandablePositionDetails = (row) =>
  (row?.lots?.length || 0) > 0 ||
  (row?.sourceAttribution?.length || 0) > 0 ||
  (row?.openOrders?.length || 0) > 0 ||
  hasTradeManagementDetail(row);

const denseColumnSortValue = (row, id, snapshotsBySymbol = {}) => {
  const quote = denseDisplayQuote(row);
  if (id === "symbol") return row.symbol;
  if (id === "underlyingPrice") return resolvePositionUnderlyingPrice(row, snapshotsBySymbol);
  if (id === "openedAt") {
    const openedAt = positionDisplayForRow(row).openedAt;
    const timestamp = openedAt ? new Date(openedAt).getTime() : null;
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (id === "price") return quote?.mark ?? quote?.last ?? row.mark;
  if (id === "quote") return quote?.spreadPercent ?? quote?.bid ?? quote?.ask;
  if (id === "stop") return tradeManagementForRow(row).sortValues.stop;
  if (id === "trail") return tradeManagementForRow(row).sortValues.trail;
  if (id === "day") return row.dayChange;
  if (id === "unrealized") return brokerUnrealizedPnlForRow(row);
  if (id === "exposure") return brokerMarketValueForRow(row);
  if (id === "greeks") return row?.optionQuote?.delta ?? row.betaWeightedDelta;
  if (id === "last") return quote?.mark ?? quote?.last ?? row.mark;
  if (id === "bid") return quote?.bid;
  if (id === "ask") return quote?.ask;
  if (id === "spreadPercent") return quote?.spreadPercent;
  if (id === "costBasis") return positionCostBasis(row);
  if (id === "delta") return row?.optionQuote?.delta;
  if (id === "theta") return row?.optionQuote?.theta;
  if (id === "signalContext") return row?.automationContext?.signalScore;
  return row[id];
};

const positionSearchText = (row) =>
  [
    row?.symbol,
    row?.description,
    row?.assetClass,
    row?.positionType,
    row?.sector,
    row?.strategyLabel,
    row?.sourceType,
    row?.optionContract?.underlying,
    tradeManagementForRow(row).statusLabel,
    optionInlineDetail(row, false),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const compactPositionContractDetail = (row) => {
  if (!isOptionPosition(row)) return "";
  const detail = optionContractTermsLabel(row?.optionContract);
  return detail && detail !== MISSING_VALUE ? detail : "";
};

const DensePositionSymbol = ({
  row,
  expanded,
  maskValues,
  snapshotsBySymbol,
  onJumpToChart,
  onPositionSelect,
  onToggle,
}) => {
  const expandable = hasExpandablePositionDetails(row);
  const contractDetail = compactPositionContractDetail(row);
  const display = positionDisplayForRow(row);
  const title = [
    row.symbol,
    optionInlineDetail(row, maskValues),
    row.description,
    display.openedLabel,
    display.ageLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: sp(4), minWidth: 0 }}>
      {expandable ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggle(row);
          }}
          aria-label={expanded ? `Collapse ${row.symbol}` : `Expand ${row.symbol}`}
          aria-expanded={expanded}
          style={{
            ...denseActionButtonStyle,
            width: dim(16),
            height: dim(16),
            flexShrink: 0,
            fontSize: fs(10),
          }}
        >
          {expanded ? "−" : "+"}
        </button>
      ) : null}
      <PositionTrendSparkline
        row={row}
        snapshotsBySymbol={snapshotsBySymbol}
        compact
        inline
      />
      <AppTooltip content={title || row.symbol}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPositionSelect?.(row);
            onJumpToChart?.(row.symbol);
          }}
          style={{
            border: "none",
            padding: 0,
            background: "transparent",
            color: CSS_COLOR.text,
            cursor: "pointer",
            textAlign: "left",
            minWidth: 0,
            flex: "1 1 auto",
          }}
        >
          <span
            data-testid="account-position-symbol"
            style={{
              display: "block",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: T.mono,
              fontSize: textSize("body"),
              color: CSS_COLOR.text,
            }}
          >
            {row.symbol || MISSING_VALUE}
          </span>
          {contractDetail ? (
            <div
              style={{
                marginTop: sp(1),
                color: CSS_COLOR.textDim,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "100%",
              }}
            >
              {contractDetail}
            </div>
          ) : null}
        </button>
      </AppTooltip>
    </div>
  );
};

const DenseSignalCell = ({ row, currency, maskValues }) => {
  const metrics = automationPositionMetrics(row, currency, maskValues);
  if (!metrics) {
    return (
      <span style={denseColumnTextStyle({ align: "center", color: CSS_COLOR.textDim, fontFamily: T.sans })}>
        {MISSING_VALUE}
      </span>
    );
  }
  const score = firstFiniteNumber(row?.automationContext?.signalScore);
  const timeframe = firstText(row?.automationContext?.timeframe).toUpperCase();
  const tone =
    score == null
      ? CSS_COLOR.textSec
      : score >= 75
        ? CSS_COLOR.green
        : score >= 50
          ? CSS_COLOR.amber
          : CSS_COLOR.textSec;
  const compactLabel = [
    score != null ? formatNumber(score, 0) : null,
    timeframe,
  ].filter(Boolean).join(" ") || metrics.signalMain;
  return (
    <AppTooltip
      content={[metrics.signalMain, metrics.signalDetail, metrics.riskMain, metrics.riskDetail]
        .filter((item) => item && item !== MISSING_VALUE)
        .join(" · ")}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: sp(3),
          width: "100%",
          minWidth: 0,
          overflow: "hidden",
          color: tone,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        <Zap size={11} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {compactLabel}
        </span>
      </span>
    </AppTooltip>
  );
};

const DensePositionActions = ({
  row,
  expanded,
  currency,
  maskValues,
  onJumpToChart,
  onPositionSelect,
  onToggle,
  onClosePosition,
  onEditProtection,
  canManagePositions,
  manageDisabledReason,
}) => {
  const expandable = hasExpandablePositionDetails(row);
  const quote = denseDisplayQuote(row);
  const bidAsk = formatPositionBidAskPair(quote, maskValues);
  const management = tradeManagementForRow(row);
  const markValue = quote?.mark ?? quote?.mid ?? row.mark;
  const openOrderCount = Array.isArray(row?.openOrders) ? row.openOrders.length : 0;
  const contractLabel =
    compactPositionContractDetail(row) ||
    (!isOptionPosition(row) ? row.assetClass : "") ||
    "";
  const sideLabel = row.quantity < 0 ? "Short" : "Long";
  const tradeAction = () => {
    onPositionSelect?.(row);
    onJumpToChart?.(row.symbol);
  };

  return (
    <PositionRowActionMenu
      testId="account-position-row-action-menu"
      symbol={row.symbol}
      contractLabel={contractLabel}
      sideLabel={sideLabel}
      statusText={management.statusLabel}
      primaryAction={{
        id: "trade",
        label: "Trade",
        description: `Open ${row.symbol} in the trade ticket`,
        Icon: Ticket,
        onSelect: tradeAction,
        disabled: !onJumpToChart,
      }}
      quoteItems={[
        {
          label: "Mark",
          value: formatAccountPrice(markValue, 2, maskValues),
        },
        {
          label: "Bid / Ask",
          value: bidAsk,
        },
        {
          label: "P&L",
          value: formatAccountSignedMoney(
            brokerUnrealizedPnlForRow(row),
            currency,
            false,
            maskValues,
          ),
          tone: toneForValue(brokerUnrealizedPnlForRow(row)),
        },
        {
          label: "Stop",
          value: formatTradeManagementPrice(management.stop, maskValues),
          tone: management.stop ? tradeManagementTone(management) : CSS_COLOR.textMuted,
        },
      ]}
      utilityActions={[
        {
          id: "details",
          label: expanded ? "Collapse" : "Details",
          description: expandable
            ? `${expanded ? "Collapse" : "Expand"} position lots, orders, and attribution`
            : "No additional detail is available for this row",
          Icon: Info,
          onSelect: () => onToggle(row),
          disabled: !expandable,
          tone: "info",
        },
        {
          id: "orders",
          label: openOrderCount ? `${openOrderCount} order${openOrderCount === 1 ? "" : "s"}` : "Orders",
          description: openOrderCount
            ? "Expand this row to inspect linked working orders"
            : "No linked working orders",
          Icon: ClipboardList,
          onSelect: () => onToggle(row),
          disabled: !openOrderCount,
          tone: "warning",
        },
        {
          id: "focus",
          label: "Focus",
          description: `Focus ${row.symbol} in the surrounding workspace`,
          Icon: Eye,
          onSelect: () => onPositionSelect?.(row),
          disabled: !onPositionSelect,
          tone: "info",
        },
      ]}
      managementActions={[
        {
          id: "adjust",
          label: "Adjust",
          description: canManagePositions
            ? "Set or replace the protective stop"
            : manageDisabledReason || "Position management is unavailable",
          Icon: SlidersHorizontal,
          onSelect: () => onEditProtection?.(row),
          disabled: !onEditProtection || !canManagePositions,
          tone: "warning",
        },
        {
          id: "close",
          label: "Close",
          description: canManagePositions
            ? "Flatten this position with a market order"
            : manageDisabledReason || "Position management is unavailable",
          Icon: XCircle,
          onSelect: () => onClosePosition?.(row),
          disabled: !onClosePosition || !canManagePositions,
          tone: "danger",
        },
        {
          id: "roll",
          label: "Roll",
          description: "Roll workflow is disabled until a broker-safe multi-leg order flow exists.",
          Icon: RotateCcw,
          disabled: true,
          tone: "info",
        },
      ]}
    />
  );
};

const DenseUnderlyingPriceCell = ({
  row,
  column,
  maskValues,
  snapshotsBySymbol,
  expanded,
}) => {
  const underlyingPrice = resolvePositionUnderlyingPrice(row, snapshotsBySymbol);
  const flashClassName = useValueFlash(underlyingPrice);
  return (
    <td style={denseTableCellStyle(column, expanded)}>
      <AppTooltip content={positionUnderlyingPriceTitle(row, snapshotsBySymbol, maskValues)}>
        <span
          className={flashClassName}
          style={{
            ...denseColumnTextStyle({
              align: column.align,
              color: underlyingPrice != null ? CSS_COLOR.text : CSS_COLOR.textDim,
            }),
            display: "inline-flex",
            justifyContent: denseVisualAlign(column.align),
            maxWidth: "100%",
            padding: sp("1px 2px"),
            borderRadius: dim(RADII.xs),
            whiteSpace: "nowrap",
          }}
        >
          {formatAccountPrice(underlyingPrice, 2, maskValues)}
        </span>
      </AppTooltip>
    </td>
  );
};

const StopEditAffordance = ({ disabled, title, onClick }) => (
  <AppTooltip content={title}>
    <button
      type="button"
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        flexShrink: 0,
        display: "inline-grid",
        placeItems: "center",
        width: dim(18),
        height: dim(18),
        border: "none",
        background: "transparent",
        color: disabled ? CSS_COLOR.textDim : CSS_COLOR.textMuted,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 0.7,
        borderRadius: dim(RADII.xs),
        padding: 0,
        transition: "color 120ms ease, opacity 120ms ease, background 120ms ease",
      }}
      onMouseEnter={(event) => {
        if (disabled) return;
        event.currentTarget.style.opacity = "1";
        event.currentTarget.style.color = CSS_COLOR.accent;
        event.currentTarget.style.background = cssColorMix(CSS_COLOR.accent, 12);
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.opacity = disabled ? "0.4" : "0.7";
        event.currentTarget.style.color = disabled ? CSS_COLOR.textDim : CSS_COLOR.textMuted;
        event.currentTarget.style.background = "transparent";
      }}
    >
      <Pencil size={11} strokeWidth={1.8} aria-hidden="true" />
    </button>
  </AppTooltip>
);

const DensePositionCell = ({
  row,
  column,
  currency,
  maskValues,
  snapshotsBySymbol,
  underlyingSnapshotsBySymbol,
  expanded,
  onJumpToChart,
  onPositionSelect,
  onToggle,
  onClosePosition,
  onEditProtection,
  canManagePositions,
  manageDisabledReason,
}) => {
  const quote = denseDisplayQuote(row);
  const bidAsk = formatPositionBidAskPair(quote, maskValues);
  const quoteHasBidAsk = hasPositionBidAsk(quote);
  const spread = formatPositionSpreadLabel(quote, (value) =>
    formatAccountPercent(value, 1, maskValues),
  );
  const quoteDetail = [spread, formatQuoteUpdatedDetail(quote)]
    .filter(Boolean)
    .join(" · ");
  const management = tradeManagementForRow(row);
  const managementTitle = tradeManagementTitle(management, currency, maskValues);
  const markValue = quote?.mark ?? quote?.mid ?? row.mark;
  const greeksPrimary =
    [
      formatGreek("Δ", row?.optionQuote?.delta, 2),
      formatGreek("θ", row?.optionQuote?.theta, 2),
    ].filter(Boolean).join(" · ") || MISSING_VALUE;
  const greeksSecondary = [
    formatIv(row?.optionQuote?.impliedVolatility),
    row?.optionQuote?.openInterest != null
      ? `OI ${formatMetricCount(row.optionQuote.openInterest)}`
      : null,
    row?.optionQuote?.volume != null
      ? `Vol ${formatMetricCount(row.optionQuote.volume)}`
      : null,
  ].filter(Boolean).join(" · ");
  let content = MISSING_VALUE;
  let color = CSS_COLOR.textSec;
  let title = undefined;

  if (column.id === "symbol") {
    return (
      <td style={denseTableCellStyle(column, expanded)}>
        <DensePositionSymbol
          row={row}
          expanded={expanded}
          maskValues={maskValues}
          snapshotsBySymbol={snapshotsBySymbol}
          onJumpToChart={onJumpToChart}
          onPositionSelect={onPositionSelect}
          onToggle={onToggle}
        />
      </td>
    );
  }

  if (column.id === "actions") {
    return (
      <td style={denseTableCellStyle(column, expanded)}>
        <DensePositionActions
          row={row}
          expanded={expanded}
          currency={currency}
          maskValues={maskValues}
          onJumpToChart={onJumpToChart}
          onPositionSelect={onPositionSelect}
          onToggle={onToggle}
          onClosePosition={onClosePosition}
          onEditProtection={onEditProtection}
          canManagePositions={canManagePositions}
          manageDisabledReason={manageDisabledReason}
        />
      </td>
    );
  }

  if (column.id === "signalContext") {
    return (
      <td style={denseTableCellStyle(column, expanded)}>
        <DenseSignalCell row={row} currency={currency} maskValues={maskValues} />
      </td>
    );
  }

  if (column.id === "quantity") {
    content = formatNumber(row.quantity, 4);
    color = row.quantity < 0 ? CSS_COLOR.red : CSS_COLOR.textSec;
  } else if (column.id === "underlyingPrice") {
    return (
      <DenseUnderlyingPriceCell
        row={row}
        column={column}
        maskValues={maskValues}
        snapshotsBySymbol={underlyingSnapshotsBySymbol}
        expanded={expanded}
      />
    );
  } else if (column.id === "price") {
    return (
      <td style={denseTableCellStyle(column, expanded)}>
        <DenseStackedValue
          primary={formatAccountPrice(markValue, 2, maskValues)}
          primaryTone={CSS_COLOR.text}
          align={column.align}
          title={formatQuoteUpdatedDetail(quote)}
        />
      </td>
    );
  } else if (column.id === "quote") {
    return (
      <td style={denseTableCellStyle(column, expanded)}>
        <DenseStackedValue
          primary={bidAsk}
          primaryTone={quoteHasBidAsk ? CSS_COLOR.textSec : CSS_COLOR.textDim}
          align={column.align}
          title={[bidAsk, quoteDetail].filter(Boolean).join(" · ")}
        />
      </td>
    );
  } else if (column.id === "stop") {
    const stopEditable = Boolean(onEditProtection) && canManagePositions;
    return (
      <td style={denseTableCellStyle(column, expanded)}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: sp(2),
          }}
        >
          <div style={{ minWidth: 0, flex: "0 1 auto" }}>
            <DenseStackedValue
              primary={formatTradeManagementPrice(management.stop, maskValues)}
              secondary={tradeManagementStopSubtext(management, maskValues)}
              primaryTone={
                management.stop
                  ? management.trail
                    ? CSS_COLOR.textSec
                    : tradeManagementTone(management)
                  : CSS_COLOR.textDim
              }
              secondaryTone={
                management.stop && !management.trail
                  ? tradeManagementDistanceTone(management)
                  : CSS_COLOR.textDim
              }
              align={column.align}
              title={managementTitle}
            />
          </div>
          <StopEditAffordance
            disabled={!stopEditable}
            title={
              stopEditable
                ? management.stop
                  ? "Adjust protective stop"
                  : "Set protective stop"
                : manageDisabledReason || "Stop editing unavailable"
            }
            onClick={(event) => {
              event.stopPropagation();
              if (stopEditable) onEditProtection?.(row);
            }}
          />
        </div>
      </td>
    );
  } else if (column.id === "trail") {
    return (
      <td style={denseTableCellStyle(column, expanded)}>
        <DenseStackedValue
          primary={formatTradeManagementPrice(management.trail, maskValues)}
          secondary={tradeManagementTrailSubtext(management, maskValues)}
          primaryTone={management.trail ? tradeManagementTone(management) : CSS_COLOR.textDim}
          secondaryTone={
            management.trail ? tradeManagementDistanceTone(management) : CSS_COLOR.textDim
          }
          align={column.align}
          title={managementTitle}
        />
      </td>
    );
  } else if (column.id === "day") {
    return (
      <td style={denseTableCellStyle(column, expanded)}>
        <DenseStackedValue
          primary={formatAccountSignedMoney(row.dayChange, currency, false, maskValues)}
          secondary={signedPercent(row.dayChangePercent, 2, maskValues)}
          primaryTone={toneForValue(row.dayChange)}
          secondaryTone={toneForValue(row.dayChangePercent)}
          align={column.align}
        />
      </td>
    );
  } else if (column.id === "unrealized") {
    return (
      <td style={denseTableCellStyle(column, expanded)}>
        <DenseStackedValue
          primary={formatAccountSignedMoney(brokerUnrealizedPnlForRow(row), currency, false, maskValues)}
          secondary={signedPercent(brokerUnrealizedPnlPercentForRow(row), 2, maskValues)}
          primaryTone={toneForValue(brokerUnrealizedPnlForRow(row))}
          secondaryTone={toneForValue(brokerUnrealizedPnlPercentForRow(row))}
          align={column.align}
        />
      </td>
    );
  } else if (column.id === "exposure") {
    return (
      <td style={denseTableCellStyle(column, expanded)}>
        <DenseStackedValue
          primary={formatAccountMoney(brokerMarketValueForRow(row), currency, false, maskValues)}
          secondary={`Wt ${formatAccountPercent(row.weightPercent, 2, maskValues)}`}
          primaryTone={CSS_COLOR.text}
          align={column.align}
        />
      </td>
    );
  } else if (column.id === "greeks") {
    return (
      <td style={denseTableCellStyle(column, expanded)}>
        <DenseGreekCell
          row={row}
          title={[greeksPrimary, greeksSecondary].filter(Boolean).join(" · ")}
        />
      </td>
    );
  } else if (column.id === "averageCost") {
    content = formatAccountPrice(row.averageCost, 2, maskValues);
  } else if (column.id === "last") {
    content = formatAccountPrice(quote?.mark ?? quote?.last ?? row.mark, 2, maskValues);
  } else if (column.id === "bid") {
    content = formatAccountPrice(quote?.bid, 2, maskValues);
  } else if (column.id === "ask") {
    content = formatAccountPrice(quote?.ask, 2, maskValues);
  } else if (column.id === "spreadPercent") {
    content = formatAccountPercent(quote?.spreadPercent, 1, maskValues);
    title = [formatPositionSpreadLabel(quote, (value) => formatAccountPercent(value, 2, maskValues)), formatQuoteUpdatedDetail(quote)]
      .filter(Boolean)
      .join(" · ");
  } else if (column.id === "dayChange") {
    content = formatAccountSignedMoney(row.dayChange, currency, false, maskValues);
    color = toneForValue(row.dayChange);
  } else if (column.id === "dayChangePercent") {
    content = signedPercent(row.dayChangePercent, 2, maskValues);
    color = toneForValue(row.dayChangePercent);
  } else if (column.id === "unrealizedPnl") {
    content = formatAccountSignedMoney(brokerUnrealizedPnlForRow(row), currency, false, maskValues);
    color = toneForValue(brokerUnrealizedPnlForRow(row));
  } else if (column.id === "unrealizedPnlPercent") {
    content = signedPercent(brokerUnrealizedPnlPercentForRow(row), 2, maskValues);
    color = toneForValue(brokerUnrealizedPnlPercentForRow(row));
  } else if (column.id === "marketValue") {
    content = formatAccountMoney(brokerMarketValueForRow(row), currency, false, maskValues);
    color = CSS_COLOR.text;
  } else if (column.id === "weightPercent") {
    content = formatAccountPercent(row.weightPercent, 2, maskValues);
  } else if (column.id === "delta") {
    content = formatNumber(row?.optionQuote?.delta, 2);
  } else if (column.id === "theta") {
    content = formatNumber(row?.optionQuote?.theta, 2);
  }

  return (
    <td style={denseTableCellStyle(column, expanded)}>
      <AppTooltip content={title}>
        <span style={denseColumnTextStyle({ align: column.align, color })}>
          {content}
        </span>
      </AppTooltip>
    </td>
  );
};

const summarySegments = ({ rows, displayTotals, totalDayChange, currency, maskValues }) => {
  const netDelta = rows.reduce(
    (sum, row) => sum + (firstFiniteNumber(row.betaWeightedDelta) ?? 0),
    0,
  );
  const netTheta = rows.reduce(
    (sum, row) => sum + (firstFiniteNumber(row?.optionQuote?.theta) ?? 0),
    0,
  );
  const cash = firstDisplayTotalNumber(
    displayTotals.cash,
    displayTotals.totalCash,
    displayTotals.totalCashValue,
  );
  const buyingPower = firstDisplayTotalNumber(displayTotals.buyingPower);
  const netLiquidation = firstDisplayTotalNumber(displayTotals.netLiquidation);
  return [
    { label: "SUMMARY", value: `${formatNumber(rows.length, 0)} positions`, color: CSS_COLOR.text },
    {
      label: "Net",
      value: formatAccountMoney(displayTotals.netExposure, currency, false, maskValues),
      color: CSS_COLOR.textSec,
    },
    cash != null
      ? {
          label: "Cash",
          value: formatAccountMoney(cash, currency, false, maskValues),
          color: CSS_COLOR.textSec,
        }
      : null,
    netLiquidation != null
      ? {
          label: "NLV",
          value: formatAccountMoney(netLiquidation, currency, false, maskValues),
          color: CSS_COLOR.textSec,
        }
      : null,
    buyingPower != null
      ? {
          label: "BP",
          value: formatAccountMoney(buyingPower, currency, false, maskValues),
          color: CSS_COLOR.textSec,
        }
      : null,
    {
      label: "Day",
      value: formatAccountSignedMoney(totalDayChange, currency, false, maskValues),
      extra: signedPercent(
        displayTotals.netExposure
          ? (totalDayChange / Math.abs(displayTotals.netExposure)) * 100
          : null,
        2,
        maskValues,
      ),
      color: toneForValue(totalDayChange),
    },
    {
      label: "Unreal",
      value: formatAccountSignedMoney(displayTotals.unrealizedPnl, currency, false, maskValues),
      extra: signedPercent(
        displayTotals.netExposure
          ? (displayTotals.unrealizedPnl / Math.abs(displayTotals.netExposure)) * 100
          : null,
        2,
        maskValues,
      ),
      color: toneForValue(displayTotals.unrealizedPnl),
    },
    {
      label: "Wt",
      value: formatAccountPercent(displayTotals.weightPercent, 2, maskValues),
      color: CSS_COLOR.textSec,
    },
    {
      label: "Net Delta",
      value: formatNumber(netDelta, 1),
      color: CSS_COLOR.textSec,
    },
    netTheta
      ? {
          label: "Net Theta",
          value: formatNumber(netTheta, 1),
          color: CSS_COLOR.textSec,
        }
      : null,
  ].filter(Boolean);
};

const denseSummaryCellStyle = (column, { bottomOffset = 0 } = {}) => ({
  ...denseTableCellStyle(column),
  padding: column.align === "right" ? sp("3px 4px 3px 2px") : sp("3px 6px"),
  background: CSS_COLOR.bg1,
  borderTop: denseTableDivider(),
  position: column.sticky ? "sticky" : undefined,
  bottom: bottomOffset ? dim(bottomOffset) : 0,
  left: column.sticky ? 0 : undefined,
  zIndex: column.sticky ? 4 : 3,
});

const DenseCashRow = ({
  columns,
  displayTotals,
  currency,
  maskValues,
}) => {
  const cash = firstDisplayTotalNumber(
    displayTotals.cash,
    displayTotals.totalCash,
    displayTotals.totalCashValue,
  );
  const cashValue =
    cash == null ? MISSING_VALUE : formatAccountMoney(cash, currency, false, maskValues);
  const buyingPower = firstDisplayTotalNumber(displayTotals.buyingPower);
  const netLiquidation = firstDisplayTotalNumber(displayTotals.netLiquidation);

  return (
    <tr
      data-testid="account-positions-cash-row"
      style={{
        background: CSS_COLOR.bg1,
        position: "sticky",
        bottom: dim(POSITION_TABLE_ROW_HEIGHT),
        zIndex: 2,
      }}
    >
      {columns.map((column) => {
        let content = "";
        if (column.id === "symbol") {
          content = (
            <DenseStackedValue
              primary="Cash"
              secondary="Account balance"
              primaryTone={CSS_COLOR.text}
              align="left"
            />
          );
        } else if (column.id === "exposure") {
          content = (
            <DenseStackedValue
              primary={cashValue}
              secondary={
                netLiquidation != null
                  ? `NLV ${formatAccountMoney(netLiquidation, currency, false, maskValues)}`
                  : ""
              }
              primaryTone={CSS_COLOR.text}
              align={column.align}
            />
          );
        } else if (column.id === "signalContext" && buyingPower != null) {
          content = (
            <DenseStackedValue
              primary={`BP ${formatAccountMoney(buyingPower, currency, false, maskValues)}`}
              primaryTone={CSS_COLOR.textSec}
              align={column.align}
            />
          );
        }

        return (
          <td
            key={column.id}
            style={denseSummaryCellStyle(column, {
              bottomOffset: POSITION_TABLE_ROW_HEIGHT,
            })}
          >
            {content}
          </td>
        );
      })}
    </tr>
  );
};

const DenseSummaryRow = ({
  columns,
  rows,
  displayTotals,
  totalDayChange,
  currency,
  maskValues,
}) => {
  const segments = summarySegments({
    rows,
    displayTotals,
    totalDayChange,
    currency,
    maskValues,
  });
  const summaryByColumn = new Map(
    segments.map((segment) => [segment.label, segment]),
  );
  const netSegment = summaryByColumn.get("Net");
  const cashSegment = summaryByColumn.get("Cash");
  const nlvSegment = summaryByColumn.get("NLV");
  const buyingPowerSegment = summaryByColumn.get("BP");
  const daySegment = summaryByColumn.get("Day");
  const unrealSegment = summaryByColumn.get("Unreal");
  const weightSegment = summaryByColumn.get("Wt");
  const deltaSegment = summaryByColumn.get("Net Delta");
  const thetaSegment = summaryByColumn.get("Net Theta");

  return (
    <tr
      data-testid="account-positions-summary-row"
      style={{
        background: CSS_COLOR.bg1,
        position: "sticky",
        bottom: 0,
        zIndex: 2,
      }}
    >
      {columns.map((column) => {
        let content = "";
        if (column.id === "symbol") {
          content = (
            <DenseStackedValue
              primary="Total"
              secondary={[
                `${formatNumber(rows.length, 0)} positions`,
                cashSegment ? `Cash ${cashSegment.value}` : null,
              ].filter(Boolean).join(" · ")}
              primaryTone={CSS_COLOR.text}
              align="left"
            />
          );
        } else if (column.id === "day" && daySegment) {
          content = (
            <DenseStackedValue
              primary={daySegment.value}
              secondary={daySegment.extra}
              primaryTone={daySegment.color}
              secondaryTone={daySegment.color}
              align={column.align}
            />
          );
        } else if (column.id === "unrealized" && unrealSegment) {
          content = (
            <DenseStackedValue
              primary={unrealSegment.value}
              secondary={unrealSegment.extra}
              primaryTone={unrealSegment.color}
              secondaryTone={unrealSegment.color}
              align={column.align}
            />
          );
        } else if (column.id === "exposure" && netSegment) {
          content = (
            <DenseStackedValue
              primary={netSegment.value}
              secondary={
                nlvSegment
                  ? `NLV ${nlvSegment.value}`
                  : cashSegment
                    ? `Cash ${cashSegment.value}`
                    : weightSegment
                      ? `Wt ${weightSegment.value}`
                      : ""
              }
              primaryTone={CSS_COLOR.text}
              align={column.align}
            />
          );
        } else if (column.id === "signalContext" && buyingPowerSegment) {
          content = (
            <DenseStackedValue
              primary={`BP ${buyingPowerSegment.value}`}
              primaryTone={CSS_COLOR.textSec}
              align={column.align}
            />
          );
        } else if (column.id === "greeks" && deltaSegment) {
          content = (
            <DenseStackedValue
              primary={`Δ${deltaSegment.value}`}
              secondary={thetaSegment ? `θ${thetaSegment.value}` : ""}
              primaryTone={CSS_COLOR.textSec}
              align={column.align}
            />
          );
        }

        return (
          <td key={column.id} style={denseSummaryCellStyle(column)}>
            {content}
          </td>
        );
      })}
    </tr>
  );
};

const dateLabel = (date) => {
  if (!date) return "Live";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
};

const ActivityTone = ({ activity }) => {
  const tone = activity?.type === "trade_buy"
    ? "side-buy"
    : activity?.type === "trade_sell"
      ? "side-sell"
      : Number(activity?.amount) >= 0
        ? "pnl-positive"
        : "pnl-negative";
  return (
    <Pill tone={tone}>
      {String(activity?.type || "event").replace(/_/g, " ")}
    </Pill>
  );
};

const historicalPositionHeaders = [
  "Position",
  "Qty",
  "Avg",
  "Price",
  "Day",
  "Unreal",
  "Exposure",
];

export const PositionsAtDateInspector = ({
  query,
  activeDate,
  pinnedDate,
  currentPositionsCount = 0,
  currency,
  maskValues = false,
  onClearPin,
  onJumpToChart,
}) => {
  const data = query.data || null;
  const inspecting = Boolean(activeDate);
  const inspectorState = buildPositionsAtDateInspectorState({
    activeDate,
    pinnedDate,
    response: data,
    currentPositionsCount,
  });
  const positions = inspectorState.positions;
  const activity = inspectorState.activity;
  const balance = inspectorState.balance;
  const title = pinnedDate
    ? `Positions @ ${dateLabel(pinnedDate)}`
    : activeDate
      ? `Positions @ ${dateLabel(activeDate)}`
      : inspectorState.title;

  return (
    <Panel
      title={title}
      rightRail={
        inspecting
          ? inspectorState.rightRail
          : `${formatNumber(currentPositionsCount, 0)} current positions`
      }
      loading={Boolean(inspecting && query.isLoading)}
      error={inspecting ? query.error : null}
      onRetry={inspecting ? query.refetch : undefined}
      minHeight={136}
      action={
        pinnedDate ? (
          <Button variant="secondary" onClick={onClearPin}>
            Clear Pin
          </Button>
        ) : null
      }
    >
      {!inspecting ? (
        <EmptyState
          title="Move over the equity curve"
          body="Hover a date to preview that day's positions and activity. Click the chart to pin the date for inspection."
        />
      ) : inspectorState.unavailable ? (
        <EmptyState
          title="No positions for this date"
          body={inspectorState.message || "No historical position snapshot or account activity exists for the selected date."}
        />
      ) : (
        <div style={{ display: "grid", gap: sp(6) }}>
          {balance ? (
            <div
              className="ra-hide-scrollbar"
              style={{
                overflowX: "auto",
              }}
            >
              <table
                data-testid="account-position-date-balance-table"
                style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}
              >
                <thead>
                  <tr style={tableHeaderStyle}>
                    {["Net Liq", "Day P&L", "Cash", "Buying Power"].map((label) => (
                      <th key={label} style={compactPositionHeaderStyle({ align: "right" })}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="ra-table-row">
                    {[
                      [formatAccountMoney(balance.netLiquidation, currency, false, maskValues), CSS_COLOR.text],
                      [formatAccountSignedMoney(balance.dayPnl, currency, false, maskValues), toneForValue(balance.dayPnl)],
                      [formatAccountMoney(balance.cash, currency, false, maskValues), CSS_COLOR.text],
                      [formatAccountMoney(balance.buyingPower, currency, false, maskValues), CSS_COLOR.text],
                    ].map(([value, color], index) => (
                      <td
                        key={index}
                        style={{
                          ...compactPositionCellStyle({
                            align: "right",
                            color,
                            fontFamily: T.data,
                          }),
                          color,
                        }}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
          <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
            <Pill tone="cyan">
              {positions.length} positions
            </Pill>
            <Pill tone="purple">
              {activity.length} activity rows
            </Pill>
            {balance?.dayPnlPercent != null ? (
              <Pill tone={Number(balance.dayPnlPercent) >= 0 ? "pnl-positive" : "pnl-negative"}>
                {formatAccountPercent(balance.dayPnlPercent, 2, maskValues)}
              </Pill>
            ) : null}
            {data?.snapshotDate ? (
              <Pill tone="default">
                as of {formatAppDateTime(data.snapshotDate)}
              </Pill>
            ) : null}
          </div>
          {!positions.length && inspectorState.message ? (
            <div style={{ color: CSS_COLOR.textMuted, fontSize: textSize("caption"), lineHeight: 1.35 }}>
              {inspectorState.message}
            </div>
          ) : null}

          <div
            data-account-sidebar-grid
            style={{
              display: "grid",
              gridTemplateColumns: `minmax(0, 1fr) minmax(${dim(280)}px, 0.8fr)`,
              gap: sp(7),
              alignItems: "start",
            }}
          >
            <div className="ra-hide-scrollbar" style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 790, tableLayout: "fixed" }}>
                <thead>
                  <tr style={tableHeaderStyle}>
                    {historicalPositionHeaders.map((column) => (
                      <th
                        key={column}
                        style={compactPositionHeaderStyle({
                          align: column === "Symbol" ? "left" : "right",
                        })}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.slice(0, 8).map((row, rowIndex) => {
                    const display = positionDisplayForRow(row);
                    const markValue = row.mark;

                    return (
                      <tr
                        key={row.id}
                        className={[
                          "ra-table-row",
                          rowIndex % 2 ? "ra-position-table-row--alt" : null,
                        ].filter(Boolean).join(" ")}
                      >
                        <td style={{ ...compactPositionCellStyle({ color: CSS_COLOR.text }), fontWeight: FONT_WEIGHTS.regular }}>
                          <div style={{ display: "flex", alignItems: "center", gap: sp(5), minWidth: 0 }}>
                            <PositionTrendSparkline
                              row={row}
                              snapshotsBySymbol={{}}
                              compact
                              inline
                            />
                            <button
                              type="button"
                              onClick={() => onJumpToChart?.(row.symbol)}
                              style={{
                                border: "none",
                                padding: 0,
                                background: "transparent",
                                color: CSS_COLOR.text,
                                cursor: "pointer",
                                textAlign: "left",
                                minWidth: 0,
                              }}
                            >
                              <AppTooltip
                                content={[
                                  row.symbol,
                                  optionInlineDetail(row, maskValues),
                                  row.description,
                                  display.openedLabel,
                                ].filter(Boolean).join(" · ")}
                              >
                                <span
                                  data-testid="account-position-date-symbol"
                                  style={{
                                    display: "block",
                                    maxWidth: dim(132),
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    fontFamily: T.mono,
                                  }}
                                >
                                  {row.symbol || MISSING_VALUE}
                                </span>
                              </AppTooltip>
                              {compactPositionContractDetail(row) ? (
                                <div style={cellSubTextStyle(CSS_COLOR.textDim)}>
                                  {compactPositionContractDetail(row)}
                                </div>
                              ) : null}
                            </button>
                          </div>
                        </td>
                        <td style={compactPositionCellStyle({ align: "right" })}>
                          <span style={denseColumnTextStyle({ align: "right", color: row.quantity < 0 ? CSS_COLOR.red : CSS_COLOR.textSec })}>
                            {formatNumber(row.quantity, 3)}
                          </span>
                        </td>
                        <td style={compactPositionCellStyle({ align: "right" })}>
                          <span style={denseColumnTextStyle({ align: "right", color: CSS_COLOR.textSec })}>
                            {formatAccountPrice(row.averageCost, 2, maskValues)}
                          </span>
                        </td>
                        <td style={compactPositionCellStyle({ align: "right" })}>
                          <DenseStackedValue
                            primary={formatAccountPrice(markValue, 2, maskValues)}
                            primaryTone={CSS_COLOR.text}
                          />
                        </td>
                        <td style={compactPositionCellStyle({ align: "right" })}>
                          <DenseStackedValue
                            primary={formatAccountSignedMoney(row.dayChange, currency, false, maskValues)}
                            secondary={signedPercent(row.dayChangePercent, 2, maskValues)}
                            primaryTone={toneForValue(row.dayChange)}
                            secondaryTone={toneForValue(row.dayChangePercent)}
                          />
                        </td>
                        <td style={compactPositionCellStyle({ align: "right" })}>
                          <DenseStackedValue
                            primary={formatAccountSignedMoney(brokerUnrealizedPnlForRow(row), currency, false, maskValues)}
                            secondary={signedPercent(brokerUnrealizedPnlPercentForRow(row), 2, maskValues)}
                            primaryTone={toneForValue(brokerUnrealizedPnlForRow(row))}
                            secondaryTone={toneForValue(brokerUnrealizedPnlPercentForRow(row))}
                          />
                        </td>
                        <td style={compactPositionCellStyle({ align: "right" })}>
                          <DenseStackedValue
                            primary={formatAccountMoney(brokerMarketValueForRow(row), currency, false, maskValues)}
                            secondary={`Wt ${formatAccountPercent(row.weightPercent, 2, maskValues)}`}
                            primaryTone={CSS_COLOR.text}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {positions.length > 8 ? (
                <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("body"), marginTop: sp(3) }}>
                  Showing 8 of {formatNumber(positions.length, 0)} positions.
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: sp(4) }}>
              <div style={mutedLabelStyle}>DATE ACTIVITY</div>
              {activity.length ? (
                <div className="ra-hide-scrollbar" style={{ overflowX: "auto" }}>
                  <table
                    data-testid="account-position-date-activity-table"
                    style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}
                  >
                    <thead>
                      <tr style={tableHeaderStyle}>
                        {["Type", "When", "Symbol", "Amount"].map((label) => (
                          <th
                            key={label}
                            style={compactPositionHeaderStyle({
                              align: label === "Amount" ? "right" : "left",
                            })}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activity.slice(0, 7).map((row, rowIndex) => (
                        <tr
                          key={row.id}
                          className={[
                            "ra-table-row",
                            rowIndex % 2 ? "ra-position-table-row--alt" : null,
                          ].filter(Boolean).join(" ")}
                        >
                          <td style={compactPositionCellStyle()}>
                            <ActivityTone activity={row} />
                          </td>
                          <td style={compactPositionCellStyle({ color: CSS_COLOR.textDim })}>
                            {formatAppDateTime(row.timestamp)}
                          </td>
                          <td style={compactPositionCellStyle({ color: CSS_COLOR.textSec })}>
                            {row.symbol || row.source}
                          </td>
                          <td
                            style={compactPositionCellStyle({
                              align: "right",
                              color: toneForValue(row.realizedPnl ?? row.amount),
                              fontFamily: T.data,
                            })}
                          >
                            {row.realizedPnl != null
                              ? formatAccountMoney(row.realizedPnl, currency, true, maskValues)
                              : formatAccountMoney(row.amount, currency, true, maskValues)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("caption") }}>
                  No account activity is recorded for this date.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};

export const PositionsPanel = ({
  query,
  currency,
  assetFilter,
  onAssetFilterChange,
  sourceFilter = "all",
  onSourceFilterChange,
  onJumpToChart,
  rightRail = "Positions + lots",
  emptyBody = "Positions from the broker account stream will appear here. Tax lots fill in from the local ledger as fills are observed.",
  maskValues = false,
  isPhone = false,
  showFilters = true,
  onPositionSelect,
  liveOptionQuotesEnabled = true,
  streamLiveOptionQuotes = true,
  optionQuoteStreamOwner = "account-position-option-quotes:ui",
  optionQuoteStreamIntent = "account-monitor-live",
  registerMarketDataSymbols = true,
  surfaceId = POSITION_TABLE_SURFACE_ACCOUNT,
  accountId = null,
  environment = "live",
  gatewayTradingReady = false,
  gatewayTradingMessage = "Broker gateway must be connected before trading.",
  brokerConfigured = false,
  brokerAuthenticated = false,
}) => {
  const [sort, setSort] = useState({ id: "exposure", dir: "desc" });
  const [columnOrder, setColumnOrder] = useState(() =>
    normalizeColumnOrder(
      _initialState[positionColumnOrderStateKey(surfaceId)],
      positionTableColumnIdsForSurface(surfaceId),
    ),
  );
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [page, setPage] = useState(0);
  const [symbolSearch, setSymbolSearch] = useState("");
  const defaultPositionColumnIds = useMemo(
    () => positionTableColumnIdsForSurface(surfaceId),
    [surfaceId],
  );
  const visibleColumns = useMemo(
    () => orderColumnsById(getPositionTableColumns(surfaceId), columnOrder),
    [columnOrder, surfaceId],
  );
  const openPositionRows = useMemo(
    () => getOpenPositionRows(query.data?.positions || []),
    [query.data?.positions],
  );
  const sourceFilteredRows = useMemo(
    () =>
      openPositionRows.filter((row) =>
        sourceFilter === "all" ? true : row.sourceType === sourceFilter,
      ),
    [openPositionRows, sourceFilter],
  );
  const filteredRows = useMemo(() => {
    const needle = symbolSearch.trim().toLowerCase();
    if (!needle) return sourceFilteredRows;
    return sourceFilteredRows.filter((row) => positionSearchText(row).includes(needle));
  }, [sourceFilteredRows, symbolSearch]);
  const {
    rows,
    displayTotals,
    optionQuoteGroups,
    positionUnderlyingSymbols,
    underlyingSnapshotsBySymbol,
  } = useLiveOptionPositionRows({
    rows: filteredRows,
    enabled: liveOptionQuotesEnabled,
    totals: query.data?.totals,
    marketDataOwner: `positions:${surfaceId}`,
    registerMarketDataSymbols,
  });
  const sortedRows = useMemo(() => {
    if (!sort.id || !sort.dir) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = denseColumnSortValue(a, sort.id, underlyingSnapshotsBySymbol);
      const bv = denseColumnSortValue(b, sort.id, underlyingSnapshotsBySymbol);
      const numericA = Number(av);
      const numericB = Number(bv);
      const result =
        Number.isFinite(numericA) && Number.isFinite(numericB)
          ? numericA - numericB
          : String(av ?? "").localeCompare(String(bv ?? ""));
      return sort.dir === "desc" ? -result : result;
    });
    return copy;
  }, [rows, sort, underlyingSnapshotsBySymbol]);
  const paginatedPositions = paginateRows(sortedRows, page, POSITIONS_PAGE_SIZE);
  const pageRows = paginatedPositions.pageRows;
  const positionSparklineSymbols = useMemo(
    () =>
      Array.from(
        new Set(pageRows.map(resolvePositionSparklineSymbol).filter(Boolean)),
      ),
    [pageRows],
  );
  const tickerSnapshotsBySymbol = useRuntimeTickerSnapshots(positionSparklineSymbols);
  const totalDayChange = useMemo(
    () =>
      rows.reduce(
        (sum, row) =>
          sum + (Number.isFinite(Number(row.dayChange)) ? Number(row.dayChange) : 0),
        0,
      ),
    [rows],
  );

  const toggleExpanded = useCallback((rowId) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);
  useEffect(() => {
    setPage(0);
  }, [assetFilter, sourceFilter, sort.id, sort.dir, symbolSearch]);
  useEffect(() => {
    if (paginatedPositions.safePage !== page) {
      setPage(paginatedPositions.safePage);
    }
  }, [page, paginatedPositions.safePage]);
  useEffect(() => {
    persistState({
      [positionColumnOrderStateKey(surfaceId)]: normalizeColumnOrder(
        columnOrder,
        defaultPositionColumnIds,
      ),
    });
  }, [columnOrder, defaultPositionColumnIds, surfaceId]);

  const reorderPositionColumn = useCallback(
    (activeColumnId, overColumnId) => {
      setColumnOrder((current) =>
        reorderColumnOrder(
          current,
          activeColumnId,
          overColumnId,
          {
            fallbackColumnIds: defaultPositionColumnIds,
            lockedColumnIds: POSITION_LOCKED_COLUMN_IDS,
            validColumnIds: defaultPositionColumnIds,
          },
        ),
      );
    },
    [defaultPositionColumnIds],
  );

  const handlePositionToggle = useCallback(
    (row) => {
      if (!row?.id) return;
      onPositionSelect?.(row);
      if (hasExpandablePositionDetails(row)) {
        toggleExpanded(row.id);
      }
    },
    [onPositionSelect, toggleExpanded],
  );

  const toast = useToast();
  const queryClient = useQueryClient();
  const refetchPositions = query.refetch;
  const refreshBrokerQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/positions"] });
    queryClient.invalidateQueries({ queryKey: ["broker-executions"] });
    refetchPositions?.();
  }, [queryClient, refetchPositions]);
  const placeOrderMutation = usePlaceOrder({
    mutation: {
      onSuccess: refreshBrokerQueries,
    },
  });
  const previewOrderMutation = usePreviewOrder();
  const replaceOrderMutation = useReplaceOrder({
    mutation: {
      onSuccess: refreshBrokerQueries,
    },
  });

  // Live broker actions (Close, protective stop) require a healthy gateway, an
  // authenticated bridge (when IBKR is configured), and a selected account.
  const canManagePositions = Boolean(
    accountId && gatewayTradingReady && !(brokerConfigured && !brokerAuthenticated),
  );
  const manageDisabledReason = !gatewayTradingReady
    ? gatewayTradingMessage
    : brokerConfigured && !brokerAuthenticated
      ? "Authenticate your broker session before managing live positions."
      : !accountId
        ? "No broker account is selected."
        : null;

  const [liveConfirmState, setLiveConfirmState] = useState(null);
  const [liveConfirmPending, setLiveConfirmPending] = useState(false);
  const [liveConfirmError, setLiveConfirmError] = useState(null);
  const [protectionRow, setProtectionRow] = useState(null);

  const closeLiveConfirm = useCallback(() => {
    if (liveConfirmPending) return;
    setLiveConfirmError(null);
    setLiveConfirmState(null);
  }, [liveConfirmPending]);

  const runLiveConfirm = useCallback(async () => {
    if (!liveConfirmState?.onConfirm) return;
    setLiveConfirmError(null);
    setLiveConfirmPending(true);
    try {
      await liveConfirmState.onConfirm();
      setLiveConfirmState(null);
    } catch (error) {
      setLiveConfirmError(formatLiveBrokerActionError(error));
    } finally {
      setLiveConfirmPending(false);
    }
  }, [liveConfirmState]);

  const handleClosePosition = useCallback(
    (row) => {
      if (!canManagePositions) {
        toast.push({
          kind: "warn",
          title: "Trading unavailable",
          body: manageDisabledReason || "Live position management is unavailable right now.",
        });
        return;
      }
      const contractLabel = compactPositionContractDetail(row) || row.assetClass || "";
      setLiveConfirmError(null);
      setLiveConfirmState({
        title: `Flatten ${row.symbol}`,
        detail: "Submit a market order to close this position.",
        confirmLabel: "SEND CLOSE",
        confirmTone: CSS_COLOR.red,
        lines: [
          { label: "Account", value: accountId || MISSING_VALUE },
          { label: "Symbol", value: row.symbol },
          contractLabel ? { label: "Contract", value: contractLabel } : null,
          { label: "Side", value: `${row.quantity >= 0 ? "SELL" : "BUY"} to close` },
          { label: "Qty", value: String(Math.abs(row.quantity)) },
        ].filter(Boolean),
        onConfirm: async () => {
          await placeOrderMutation.mutateAsync({
            data: {
              ...buildCloseOrderRequest({ accountId, environment, position: row }),
              confirm: true,
            },
          });
          toast.push({
            kind: "success",
            title: "Close submitted",
            body: `${row.symbol} flatten order sent.`,
          });
        },
      });
    },
    [accountId, environment, canManagePositions, manageDisabledReason, placeOrderMutation, toast],
  );

  const handleEditProtection = useCallback(
    (row) => {
      if (!canManagePositions) {
        toast.push({
          kind: "warn",
          title: "Trading unavailable",
          body: manageDisabledReason || "Live position management is unavailable right now.",
        });
        return;
      }
      setProtectionRow(row);
    },
    [canManagePositions, manageDisabledReason, toast],
  );

  // Place (or replace, if a broker stop already protects the position) a
  // protective stop order. Mirrors the trade panel's preview -> replace/place
  // flow so the account surface uses the identical broker contract.
  const handleSubmitStop = useCallback(
    async (row, stopPrice) => {
      if (!row || !canManagePositions) {
        const message = manageDisabledReason || "Live position management is unavailable right now.";
        toast.push({
          kind: "warn",
          title: "Trading unavailable",
          body: message,
        });
        throw new Error(message);
      }
      const management = tradeManagementForRow(row);
      const stopRequest = buildStopOrderRequest({ accountId, environment, position: row, stopPrice });
      const preview = await previewOrderMutation.mutateAsync({ data: stopRequest });
      const existingStop =
        management.stop?.source === "broker" ? management.stop.order : null;
      if (existingStop?.id && preview?.orderPayload) {
        await replaceOrderMutation.mutateAsync({
          orderId: existingStop.id,
          data: { accountId, mode: environment, confirm: true, order: preview.orderPayload },
        });
      } else {
        await placeOrderMutation.mutateAsync({
          data: { ...stopRequest, confirm: true },
        });
      }
      toast.push({
        kind: "success",
        title: existingStop?.id ? "Stop replaced" : "Stop placed",
        body: `${row.symbol} protective stop @ ${stopPrice}`,
      });
    },
    [
      accountId,
      environment,
      canManagePositions,
      manageDisabledReason,
      previewOrderMutation,
      replaceOrderMutation,
      placeOrderMutation,
      toast,
    ],
  );

  const protectionManagement = protectionRow ? tradeManagementForRow(protectionRow) : null;
  const protectionQuote = protectionRow ? denseDisplayQuote(protectionRow) : null;
  const protectionMark =
    protectionQuote?.mark ?? protectionQuote?.mid ?? protectionRow?.mark ?? null;
  const positionsQueryActivelyFetching = Boolean(
    query.fetchStatus !== "idle" &&
      (query.isPending || query.isLoading || query.isFetching),
  );
  const positionsInitialFetchPending = Boolean(
    positionsQueryActivelyFetching && !query.data,
  );
  // When IBKR is configured but the broker session is disconnected, the positions query is
  // disabled (fetchStatus idle), so it would otherwise fall through to the
  // generic "No open positions" copy and mislabel a detached bridge as an empty
  // portfolio. Surface the real reason instead.
  const positionsBridgeDetached = Boolean(brokerConfigured && !brokerAuthenticated);
  const positionsEmptyTitle = positionsInitialFetchPending
    ? "Fetching broker positions"
    : openPositionRows.length && !rows.length
      ? "No positions match filters"
      : positionsBridgeDetached
        ? "Broker not connected"
        : "No open positions";
  const positionsEmptyBody =
    positionsInitialFetchPending
      ? "Waiting on the broker positions snapshot. The table shell is ready; rows will appear as soon as the broker returns them."
      : openPositionRows.length && !rows.length
        ? "Clear the active position filters to show the fetched broker positions."
      : positionsBridgeDetached
        ? "The broker session is not connected, so live positions can't be loaded. Reconnect the broker session to see your open positions."
        : emptyBody;

  const positionsTablePanel = (
    <Panel
      title={`Current Positions · ${rows.length}`}
      rightRail={rightRail}
      loading={false}
      error={query.error}
      onRetry={query.refetch}
      minHeight={rows.length ? 144 : 174}
      noPad
      action={(showFilters || !isPhone) ? (
        <div
          style={
            isPhone
              ? { ...mobileFilterRailStyle, opacity: rows.length ? 1 : 0.86 }
              : {
                  display: "flex",
                  gap: sp(4),
                  flexWrap: "wrap",
                  alignItems: "center",
                  opacity: rows.length ? 1 : 0.86,
                }
          }
        >
          {showFilters ? (
            <PositionFilterGroup label="Asset" isPhone={isPhone}>
              <ToggleGroup options={ASSET_FILTERS} value={assetFilter} onChange={onAssetFilterChange} />
            </PositionFilterGroup>
          ) : null}
          {showFilters && onSourceFilterChange ? (
            <PositionFilterGroup label="Source" isPhone={isPhone}>
              <ToggleGroup
                options={SOURCE_FILTERS}
                value={sourceFilter}
                onChange={onSourceFilterChange}
              />
            </PositionFilterGroup>
          ) : null}
          <PositionSymbolSearchInput
            value={symbolSearch}
            onCommit={setSymbolSearch}
            isPhone={isPhone}
          />
        </div>
      ) : null}
    >
      {streamLiveOptionQuotes ? (
        <PositionOptionQuoteStreams
          groups={optionQuoteGroups}
          enabled={liveOptionQuotesEnabled}
          owner={optionQuoteStreamOwner}
          intent={optionQuoteStreamIntent}
        />
      ) : null}
      {!rows.length ? (
        <div style={{ padding: sp(7) }}>
          <EmptyState
            title={positionsEmptyTitle}
            body={positionsEmptyBody}
          />
        </div>
      ) : (
        <div
          data-testid="account-positions-table-scroll"
          className="ra-hide-scrollbar ra-dense-table-scroll"
          style={{ overflowX: "auto" }}
        >
          <TableHeaderDndContext
            columnIds={visibleColumns.map((column) => column.id)}
            onReorder={reorderPositionColumn}
          >
            <table
              style={{
                width: "max-content",
                borderCollapse: "separate",
                borderSpacing: 0,
                minWidth: denseTableMinWidth(visibleColumns),
                tableLayout: "auto",
              }}
            >
              <colgroup>
                {visibleColumns.map((column) => (
                  <col key={column.id} style={denseTableColumnStyle(column)} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {visibleColumns.map((column) => (
                    <SortableColumnHeaderCell
                      key={column.id}
                      as="th"
                      id={column.id}
                      scope="col"
                      active={sort.id === column.id}
                      align={denseVisualAlign(column.align)}
                      label={column.shortLabel || column.label}
                      onSort={
                        column.sortable
                          ? () =>
                              setSort((current) => {
                                if (current.id !== column.id) return { id: column.id, dir: "desc" };
                                if (current.dir === "desc") return { id: column.id, dir: "asc" };
                                return { id: null, dir: null };
                              })
                          : undefined
                      }
                      reorderable={!POSITION_LOCKED_COLUMN_IDS.includes(column.id)}
                      sortDirection={sort.id === column.id ? sort.dir : null}
                      sortable={column.sortable}
                      sortTitle={`Sort by ${column.label}`}
                      style={denseHeaderCellStyle(column, sort.id === column.id)}
                      title={column.title}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
              {pageRows.map((row, rowIndex) => {
                const expanded = expandedRows.has(row.id) && hasExpandablePositionDetails(row);
                const management = tradeManagementForRow(row);
                const rowClassName = [
                  expanded ? "ra-table-row ra-table-row--selected" : "ra-table-row",
                  rowIndex % 2 ? "ra-position-table-row--alt" : null,
                ].filter(Boolean).join(" ");
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={rowClassName}
                      tabIndex={0}
                      onKeyDown={moveTableFocus}
                      style={{
                        outline: "none",
                        cursor: "pointer",
                      }}
                      onClick={() => handlePositionToggle(row)}
                    >
                      {visibleColumns.map((column) => (
                        <DensePositionCell
                          key={column.id}
                          row={row}
                          column={column}
                          currency={currency}
                          maskValues={maskValues}
                          snapshotsBySymbol={tickerSnapshotsBySymbol}
                          underlyingSnapshotsBySymbol={underlyingSnapshotsBySymbol}
                          expanded={expanded}
                          onJumpToChart={onJumpToChart}
                          onPositionSelect={onPositionSelect}
                          onToggle={handlePositionToggle}
                          onClosePosition={handleClosePosition}
                          onEditProtection={handleEditProtection}
                          canManagePositions={canManagePositions}
                          manageDisabledReason={manageDisabledReason}
                        />
                      ))}
                    </tr>
                  {expanded ? (
                    <tr>
                      <td
                        colSpan={visibleColumns.length}
                        style={{
                          ...tableCellStyle,
                          padding: sp("4px 6px 5px 22px"),
                          whiteSpace: "normal",
                          background: CSS_COLOR.bg0,
                        }}
                      >
                          <div style={{ display: "grid", gap: sp(6) }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
                            {(row.accounts || []).map((accountId) => (
                              <Pill key={`${row.id}:${accountId}`} tone="cyan">
                                {accountId}
                              </Pill>
                            ))}
                            {row.assetClass && !isOptionPosition(row) ? (
                              <Pill tone="purple">{row.assetClass}</Pill>
                            ) : null}
                            {row.sourceType ? (
                              <Pill tone={sourceTone(row.sourceType)}>
                                {row.strategyLabel || row.sourceType}
                              </Pill>
                            ) : null}
                            {row.attributionStatus && row.attributionStatus !== "attributed" ? (
                              <Pill tone={row.attributionStatus === "mixed" ? "amber" : "default"}>
                                {row.attributionStatus}
                              </Pill>
                              ) : null}
                            </div>

                            {management.stop || management.trail ? (
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: sp(8),
                                  padding: sp("6px 0"),
                                  borderTop: `1px solid ${CSS_COLOR.border}`,
                                  borderBottom: `1px solid ${CSS_COLOR.border}`,
                                }}
                              >
                                {[
                                  [
                                    management.trail ? "Hard stop" : "Stop",
                                    formatTradeManagementPrice(management.stop, maskValues),
                                    formatTradeManagementSource(management.stop?.source),
                                  ],
                                  ["Trail", formatTradeManagementPrice(management.trail, maskValues), formatTradeManagementSource(management.trail?.source)],
                                  [
                                    "Risk",
                                    formatTradeManagementDistance(management, maskValues),
                                    management.riskAmount != null
                                      ? formatAccountMoney(management.riskAmount, currency, true, maskValues)
                                      : management.statusLabel,
                                  ],
                                ].map(([label, value, detail]) => (
                                  <div key={`${row.id}:management:${label}`} style={{ minWidth: dim(92) }}>
                                    <div style={mutedLabelStyle}>{label}</div>
                                    <div
                                    style={{
                                      color:
                                        label === "Stop" || label === "Risk"
                                          ? tradeManagementTone(management)
                                          : CSS_COLOR.textSec,
                                      fontFamily: T.data,
                                      fontSize: textSize("caption"),
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                      {value}
                                    </div>
                                    <div style={cellSubTextStyle(CSS_COLOR.textDim)}>
                                      {detail || TRADE_MANAGEMENT_STATUS.unknown}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr) auto",
                              gap: sp(8),
                              alignItems: "start",
                            }}
                          >
                            <div>
                              <div style={{ ...mutedLabelStyle, marginBottom: sp(4) }}>Tax Lots</div>
                              {row.lots?.length ? (
                                <div className="ra-hide-scrollbar" style={{ overflow: "auto" }}>
                                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
                                    <thead>
                                      <tr>
                                        {lotColumns.map((label) => (
                                          <th
                                            key={label}
                                            style={compactPositionHeaderStyle({
                                              align: label === "Account" ? "left" : "right",
                                            })}
                                          >
                                            {label}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.lots.slice(0, 6).map((lot, index) => (
                                        <tr key={`${row.id}:lot:${index}`}>
                                          <td style={compactPositionCellStyle()}>{lot.accountId}</td>
                                          <td style={compactPositionCellStyle({ align: "right" })}>
                                            {formatNumber(lot.quantity, 4)}
                                          </td>
                                          <td style={compactPositionCellStyle({ align: "right" })}>
                                            {formatAccountPrice(lot.averageCost, 2, maskValues)}
                                          </td>
                                          <td style={compactPositionCellStyle({ align: "right" })}>
                                            {formatAccountMoney(lot.marketValue, currency, false, maskValues)}
                                          </td>
                                          <td
                                            style={compactPositionCellStyle({
                                              align: "right",
                                              color: toneForValue(lot.unrealizedPnl),
                                            })}
                                          >
                                            {formatAccountMoney(lot.unrealizedPnl, currency, false, maskValues)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div style={{ color: CSS_COLOR.textMuted, fontSize: textSize("body") }}>
                                  No tax-lot detail recorded yet.
                                </div>
                              )}
                            </div>

                            <div>
                              <div style={{ ...mutedLabelStyle, marginBottom: sp(4) }}>Source Attribution</div>
                              {row.sourceAttribution?.length ? (
                                <div style={{ display: "grid", gap: sp(3), marginBottom: sp(6) }}>
                                  {row.sourceAttribution.slice(0, 6).map((source, index) => (
                                    <div
                                      key={positionSourceAttributionKey(row.id, source, index)}
                                      style={{
                                        borderBottom: `1px solid ${CSS_COLOR.border}`,
                                        padding: sp("3px 0"),
                                        display: "grid",
                                        gap: sp(3),
                                      }}
                                    >
                                      <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
                                        <Pill tone={sourceTone(source.sourceType)}>
                                          {source.strategyLabel || source.sourceType}
                                        </Pill>
                                        <Pill tone="cyan">
                                          Qty {formatNumber(source.quantity, 3)}
                                        </Pill>
                                      </div>
                                      <div
                                        style={{
                                          color: CSS_COLOR.textDim,
                                          fontSize: textSize("caption"),
                                          fontFamily: T.sans,
                                        }}
                                      >
                                        {normalizeLegacyAlgoBrandText(source.deploymentName) || source.candidateId || source.sourceEventId || "Manual ledger fill"}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                  <div style={{ color: CSS_COLOR.textMuted, fontSize: textSize("body"), marginBottom: sp(8) }}>
                                  Source attribution is unavailable for this position.
                                </div>
                              )}
                              <div style={{ ...mutedLabelStyle, marginBottom: sp(4) }}>Open Orders</div>
                              {row.openOrders?.length ? (
                                <div style={{ display: "grid", gap: sp(3) }}>
                                  {row.openOrders.slice(0, 6).map((order, index) => (
                                    <div
                                      key={positionOpenOrderKey(row.id, order, index)}
                                      style={{
                                        borderBottom: `1px solid ${CSS_COLOR.border}`,
                                        padding: sp("3px 0"),
                                        display: "grid",
                                        gap: sp(3),
                                      }}
                                    >
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
                                        <Pill tone={/buy/i.test(order.side) ? "side-buy" : "side-sell"}>
                                          {order.side}
                                        </Pill>
                                        <Pill tone="default">{order.type}</Pill>
                                        <Pill tone="accent">{order.status}</Pill>
                                      </div>
                                      <div
                                        style={{
                                          color: CSS_COLOR.textSec,
                                          fontSize: textSize("body"),
                                          fontFamily: T.sans,
                                          lineHeight: 1.4,
                                        }}
                                      >
                                        {formatNumber(order.quantity, 2)} @{" "}
                                        {order.limitPrice != null
                                          ? formatAccountPrice(order.limitPrice, 2, maskValues)
                                          : order.stopPrice != null
                                            ? formatAccountPrice(order.stopPrice, 2, maskValues)
                                            : "Market"}
                                      </div>
                                      <div
                                        style={{
                                          color: CSS_COLOR.textDim,
                                          fontSize: textSize("caption"),
                                          fontFamily: T.sans,
                                        }}
                                      >
                                        {order.accountId}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ color: CSS_COLOR.textMuted, fontSize: textSize("body") }}>
                                  No working orders tied to this position.
                                </div>
                              )}
                            </div>

                            <div style={{ display: "grid", gap: sp(6), minWidth: dim(100) }}>
                              <Button
                                variant="secondary"
                                onClick={() => onJumpToChart?.(row.symbol)}
                              >
                                Chart
                              </Button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <DenseCashRow
                columns={visibleColumns}
                displayTotals={displayTotals}
                currency={currency}
                maskValues={maskValues}
              />
              <DenseSummaryRow
                columns={visibleColumns}
                rows={rows}
                displayTotals={displayTotals}
                totalDayChange={totalDayChange}
                currency={currency}
                maskValues={maskValues}
              />
            </tfoot>
          </table>
          </TableHeaderDndContext>
        </div>
	      )}
      <PaginationFooter
        dataTestId="account-positions-pagination"
        label="Rows"
        onPageChange={setPage}
        page={paginatedPositions.safePage}
        pageCount={paginatedPositions.pageCount}
        pageSize={POSITIONS_PAGE_SIZE}
        total={paginatedPositions.total}
        style={{ padding: sp("6px 10px 8px"), borderTop: `1px solid ${CSS_COLOR.border}` }}
      />
	    </Panel>
  );

  return (
    <>
      {positionsTablePanel}
      <BrokerActionConfirmDialog
        open={Boolean(liveConfirmState)}
        title={liveConfirmState?.title || "Confirm broker action"}
        detail={liveConfirmState?.detail}
        lines={liveConfirmState?.lines || []}
        confirmLabel={liveConfirmState?.confirmLabel || "CONFIRM"}
        confirmTone={liveConfirmState?.confirmTone || CSS_COLOR.red}
        pending={liveConfirmPending}
        error={liveConfirmError}
        onCancel={closeLiveConfirm}
        onConfirm={runLiveConfirm}
      />
      <PositionProtectionEditor
        position={protectionRow}
        management={protectionManagement}
        mark={protectionMark}
        maskValues={maskValues}
        accountId={accountId}
        canSubmit={canManagePositions}
        disabledReason={manageDisabledReason}
        onSubmit={(stopPrice) => handleSubmitStop(protectionRow, stopPrice)}
        onClose={() => setProtectionRow(null)}
      />
    </>
  );
};

export default PositionsPanel;
