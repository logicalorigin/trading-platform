import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import {
  getBars as getBarsRequest,
  useGetQuoteSnapshots,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  Clock,
  Columns3,
  GripVertical,
  Inbox,
  List,
  MinusCircle,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  CSS_COLOR,
  cssColorAlpha,
  cssColorMix,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatRelativeTimeShort } from "../../lib/formatters";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";
import { PaginationFooter, paginateRows } from "../../components/platform/TablePagination.jsx";
import { useStoredOptionQuoteSnapshotVersion } from "../../features/platform/live-streams";
import { IbkrStatusWave } from "../../features/platform/IbkrConnectionStatus";
import {
  BARS_QUERY_DEFAULTS,
  BARS_REQUEST_PRIORITY,
  HEAVY_PAYLOAD_GC_MS,
  buildBarsRequestOptions,
} from "../../features/platform/queryDefaults";
import { applyRuntimeQuoteSnapshots } from "../../features/platform/runtimeMarketDataModel";
import {
  publishRuntimeTickerSnapshot,
  useRuntimeTickerSnapshots,
} from "../../features/platform/runtimeTickerStore";
import { SPARKLINE_RENDER_POINT_LIMIT } from "../../features/platform/sparklineConfig";
import { buildSignalMatrixBySymbol } from "../../features/platform/watchlistModel";
import { buildSignalsMatrixHydrationPlan } from "../../features/signals/signalsMatrixHydration.js";
import { SIGNALS_TABLE_TIMEFRAMES } from "../../features/signals/signalsRowModel.js";
import { _initialState, persistState } from "../../lib/workspaceState";
import {
  asRecord,
  findSignalOptionsCandidateForSignal,
  optionProviderContractId,
  resolveSignalMove,
  resolveSignalScoreBreakdown,
} from "./algoHelpers";
import {
  buildSignalAuditProgressions,
  signalAuditRowKey,
} from "./algoAuditModel";
import {
  ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS,
  DEFAULT_SIGNAL_COLUMN_ORDER,
  DEFAULT_SIGNAL_VISIBLE_COLUMNS,
  OperationsSignalRow,
  OperationsSignalTableHeader,
  SIGNAL_COLUMN_BY_KEY,
  normalizeSignalColumnOrder,
  normalizeSignalVisibleColumns,
  signalTableMinWidth,
} from "./OperationsSignalRow";

const FILTER_OPTIONS = [
  { id: "all", label: "All", icon: List, tone: CSS_COLOR.accent },
  { id: "current", label: "Current", icon: RotateCcw, tone: CSS_COLOR.cyan },
  { id: "history", label: "History", icon: Clock, tone: CSS_COLOR.amber },
  { id: "ready", label: "Ready", icon: CheckCircle2, tone: CSS_COLOR.green },
  { id: "blocked", label: "Blocked", icon: Ban, tone: CSS_COLOR.red },
  { id: "unavailable", label: "Unavailable", icon: MinusCircle, tone: CSS_COLOR.textDim },
];

const SIGNALS_PAGE_SIZE = 20;
const SIGNAL_TABLE_SPARKLINE_HISTORY_TIMEFRAME = "1m";
const SIGNAL_TABLE_SPARKLINE_HISTORY_LIMIT = 120;
const SIGNAL_TABLE_SPARKLINE_CONCURRENCY = 4;
const SIGNAL_TABLE_QUOTE_REQUEST_OPTIONS = buildBarsRequestOptions(
  BARS_REQUEST_PRIORITY.active,
  "algo-signal-table",
);
const SIGNAL_TABLE_SPARKLINE_REQUEST_OPTIONS = buildBarsRequestOptions(
  BARS_REQUEST_PRIORITY.active,
  "algo-signal-sparkline",
);
const SIGNAL_COLUMN_VISIBILITY_VERSION = 8;
const PRIOR_DEFAULT_SIGNAL_COLUMN_ORDER = [
  "signal",
  "since",
  "move",
  "action",
  "contract",
  "quote",
  "spread",
  "greeks",
  "gate",
  "process",
  "sync",
  "score",
  "decision",
  "rowAction",
];
const PRIOR_GATE_FIRST_SIGNAL_COLUMN_ORDER = [
  "signal",
  "since",
  "move",
  "gate",
  "action",
  "contract",
  "quote",
  "spread",
  "greeks",
  "process",
  "sync",
  "score",
  "decision",
  "rowAction",
];
const PRIOR_COMPACT_SIGNAL_COLUMN_ORDER = [
  "signal",
  "since",
  "move",
  "action",
  "contract",
  "quote",
  "spread",
  "greeks",
  "gate",
  "score",
  "decision",
  "rowAction",
];
const PRIOR_GATE_FIRST_COMPACT_SIGNAL_COLUMN_ORDER = [
  "signal",
  "since",
  "move",
  "gate",
  "action",
  "contract",
  "quote",
  "spread",
  "greeks",
  "score",
  "decision",
  "rowAction",
];
const LEGACY_DEFAULT_SIGNAL_VISIBLE_COLUMNS = [
  "signal",
  "since",
  "move",
  "action",
  "contract",
  "quote",
  "spread",
  "greeks",
  "gate",
  "process",
  "sync",
  "score",
  "decision",
  "rowAction",
];
const PREVIOUS_DEFAULT_SIGNAL_VISIBLE_COLUMNS = [
  "signal",
  "since",
  "move",
  "action",
  "contract",
  "quote",
  "spread",
  "greeks",
  "gate",
  "process",
  "score",
  "decision",
  "rowAction",
];

const SORT_LABELS = {
  newest: "Newest",
  symbol: "Symbol",
  bars: "Bars",
  move: "Move",
  quoteAge: "Quote",
  spread: "Spread",
  score: "Score",
  latest: "Latest",
};

const SORT_DIRECTION_LABELS = {
  asc: "ascending",
  desc: "descending",
};

const COMPACT_SORT_OPTIONS = [
  { value: "newest:desc", label: "Newest" },
  { value: "bars:asc", label: "Freshest" },
  { value: "score:desc", label: "Score" },
  { value: "move:desc", label: "Move" },
  { value: "quoteAge:asc", label: "Quote" },
  { value: "spread:asc", label: "Spread" },
  { value: "latest:desc", label: "Latest" },
  { value: "symbol:asc", label: "Symbol" },
];

const DEFAULT_SORT_DIRECTIONS = {
  newest: "desc",
  symbol: "asc",
  bars: "asc",
  move: "desc",
  quoteAge: "asc",
  spread: "asc",
  score: "desc",
  latest: "desc",
};

const defaultSortDirection = (sortKey) => DEFAULT_SORT_DIRECTIONS[sortKey] || "desc";

const toggleSortDirection = (direction) => (direction === "asc" ? "desc" : "asc");

const settleWithConcurrency = async (items, concurrency, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = {
            status: "fulfilled",
            value: await mapper(items[index], index),
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );

  return results;
};

const barCloseValue = (bar) => {
  const close = Number(bar?.close ?? bar?.c);
  return Number.isFinite(close) ? close : null;
};

const thinBarsForSignalSparkline = (bars) => {
  const validBars = Array.isArray(bars)
    ? bars.filter((bar) => barCloseValue(bar) != null)
    : [];
  if (validBars.length <= SPARKLINE_RENDER_POINT_LIMIT) return validBars;

  const lastIndex = validBars.length - 1;
  return Array.from({ length: SPARKLINE_RENDER_POINT_LIMIT }, (_, index) => {
    const sourceIndex = Math.round(
      (index * lastIndex) / (SPARKLINE_RENDER_POINT_LIMIT - 1),
    );
    return validBars[sourceIndex];
  });
};

const hasUsableSparklineData = (value) =>
  Array.isArray(value?.sparkBars) && value.sparkBars.length >= 2 ||
  Array.isArray(value?.spark) && value.spark.length >= 2 ||
  Array.isArray(value?.bars) && value.bars.length >= 2;

const hasUsableQuoteSnapshot = (value) => {
  const price = Number(value?.price ?? value?.last ?? value?.mark);
  return Number.isFinite(price);
};

const timestampMs = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCompactStatusValue = (value) =>
  String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const pressureLevelBlocksActionWork = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "critical";
};

const resolveSignalScanWave = (freshness) => {
  if (freshness?.scanRunning) {
    return { status: "healthy", wave: "fast", color: CSS_COLOR.green };
  }
  if (freshness?.pressureLevel) {
    return { status: "capacity-limited", wave: "slow", color: CSS_COLOR.amber };
  }
  if (freshness?.staleScan) {
    return { status: "stale", wave: "flat", color: CSS_COLOR.amber };
  }
  if (freshness?.latestScanAt || freshness?.latestBarAt || freshness?.latestSignalAt) {
    return { status: "quiet", wave: "slow", color: CSS_COLOR.cyan };
  }
  return { status: "offline", wave: "flat", color: CSS_COLOR.textMuted };
};

const latestTimelineMs = (candidate) => {
  const timeline = Array.isArray(candidate?.timeline) ? candidate.timeline : [];
  return timeline.reduce(
    (latest, item) => Math.max(latest, timestampMs(asRecord(item).occurredAt)),
    0,
  );
};

const signalTimestampMs = (signal) =>
  Math.max(timestampMs(signal?.signalAt), timestampMs(signal?.currentSignalAt));

const rowActivityTimestampMs = (row) =>
  Math.max(
    signalTimestampMs(row.signal),
    timestampMs(row.candidate?.signalAt),
    timestampMs(row.candidate?.updatedAt),
    latestTimelineMs(row.candidate),
    timestampMs(row.auditProgression?.latestOccurredAt),
  );

const scoreSortValue = (scoreBreakdown) => {
  const score = scoreBreakdown?.score == null ? null : Number(scoreBreakdown.score);
  return Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;
};

const sortNumberOrNaN = (value) => {
  if (value == null || value === "") return Number.NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
};

const firstFiniteSortNumber = (...values) => {
  for (const value of values) {
    const number = sortNumberOrNaN(value);
    if (Number.isFinite(number)) return number;
  }
  return Number.NaN;
};

const signalMoveSortValue = (row) => {
  const pct = resolveSignalMove(row.signal, null, row.candidate).pct;
  return pct == null ? Number.NaN : Number(pct);
};

const signalContractPreview = (signal) => asRecord(asRecord(signal).contractPreview);

const rowMetricCandidate = (row) => {
  const candidate = asRecord(row.candidate);
  if (Object.keys(candidate).length) return candidate;
  return signalContractPreview(row.signal);
};

const quoteAgeSortValue = (candidate) => {
  const quote = asRecord(asRecord(candidate).quote);
  const age = firstFiniteSortNumber(quote.ageMs, quote.cacheAgeMs);
  if (Number.isFinite(age)) return age;
  const updatedMs = timestampMs(quote.updatedAt ?? quote.timestamp ?? quote.time);
  return updatedMs > 0 ? -updatedMs : Number.NaN;
};

const spreadSortValue = (candidate) => {
  const record = asRecord(candidate);
  const quote = asRecord(record.quote);
  const liquidity = asRecord(record.liquidity);
  const orderLiquidity = asRecord(asRecord(record.orderPlan).liquidity);
  const directSpread = firstFiniteSortNumber(
    liquidity.spreadPctOfMid,
    orderLiquidity.spreadPctOfMid,
    quote.spreadPctOfMid,
  );
  if (Number.isFinite(directSpread)) {
    return directSpread >= 1 ? directSpread / 100 : directSpread;
  }
  const bid = firstFiniteSortNumber(quote.bid, liquidity.bid, orderLiquidity.bid);
  const ask = firstFiniteSortNumber(quote.ask, liquidity.ask, orderLiquidity.ask);
  const mid = firstFiniteSortNumber(
    quote.mid,
    liquidity.mid,
    orderLiquidity.mid,
    Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number.NaN,
  );
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || !Number.isFinite(mid) || mid <= 0) {
    return Number.NaN;
  }
  return Math.max(0, ask - bid) / mid;
};

const compareFiniteValues = (aValue, bValue, sortDirection) => {
  const aFinite = Number.isFinite(aValue);
  const bFinite = Number.isFinite(bValue);
  if (aFinite && !bFinite) return -1;
  if (!aFinite && bFinite) return 1;
  if (!aFinite && !bFinite) return 0;
  return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
};

const compareTextValues = (aValue, bValue, sortDirection) => {
  const aText = String(aValue || "").trim();
  const bText = String(bValue || "").trim();
  if (aText && !bText) return -1;
  if (!aText && bText) return 1;
  if (!aText && !bText) return 0;
  return sortDirection === "asc"
    ? aText.localeCompare(bText)
    : bText.localeCompare(aText);
};

const compareTimestampValues = (aMs, bMs, sortDirection) =>
  compareFiniteValues(
    aMs > 0 ? aMs : Number.NaN,
    bMs > 0 ? bMs : Number.NaN,
    sortDirection,
  );

const sameColumnSet = (columns, expected) => {
  const source = new Set(columns);
  const target = new Set(expected);
  return source.size === target.size && expected.every((columnId) => source.has(columnId));
};

const sameColumnOrder = (columns, expected) =>
  Array.isArray(columns) &&
  columns.length === expected.length &&
  expected.every((columnId, index) => columns[index] === columnId);

const resolveInitialSignalColumnOrder = () => {
  const hasStoredOrder = Array.isArray(_initialState.algoSignalColumnOrder);
  const storedOrder = hasStoredOrder
    ? _initialState.algoSignalColumnOrder.filter((columnId) =>
        DEFAULT_SIGNAL_COLUMN_ORDER.includes(columnId),
      )
    : [];
  const normalized = normalizeSignalColumnOrder(_initialState.algoSignalColumnOrder);
  if (_initialState.algoSignalColumnVisibilityVersion === SIGNAL_COLUMN_VISIBILITY_VERSION) {
    return normalized;
  }
  if (!hasStoredOrder) return DEFAULT_SIGNAL_COLUMN_ORDER;
  if (
    sameColumnOrder(storedOrder, PRIOR_DEFAULT_SIGNAL_COLUMN_ORDER) ||
    sameColumnOrder(storedOrder, PRIOR_GATE_FIRST_SIGNAL_COLUMN_ORDER) ||
    sameColumnOrder(storedOrder, PRIOR_COMPACT_SIGNAL_COLUMN_ORDER) ||
    sameColumnOrder(storedOrder, PRIOR_GATE_FIRST_COMPACT_SIGNAL_COLUMN_ORDER)
  ) {
    return DEFAULT_SIGNAL_COLUMN_ORDER;
  }
  return normalized;
};

const resolveInitialSignalVisibleColumns = () => {
  const hasStoredColumns = Array.isArray(_initialState.algoSignalVisibleColumns);
  const normalized = normalizeSignalVisibleColumns(_initialState.algoSignalVisibleColumns);
  if (_initialState.algoSignalColumnVisibilityVersion === SIGNAL_COLUMN_VISIBILITY_VERSION) {
    return normalized;
  }
  if (!hasStoredColumns) {
    return DEFAULT_SIGNAL_VISIBLE_COLUMNS;
  }
  if (
    sameColumnSet(normalized, LEGACY_DEFAULT_SIGNAL_VISIBLE_COLUMNS) ||
    sameColumnSet(normalized, PREVIOUS_DEFAULT_SIGNAL_VISIBLE_COLUMNS)
  ) {
    return DEFAULT_SIGNAL_VISIBLE_COLUMNS;
  }
  return normalized;
};

export const classifySignal = (signal, candidate) => {
  const signalRecord = asRecord(signal);
  const candidateRecord = asRecord(candidate);
  if (signalRecord.status === "unavailable") return "unavailable";
  if (signalRecord.actionEligible === false || signalRecord.actionBlocker) {
    return "blocked";
  }
  if (!Object.keys(candidateRecord).length) return "blocked";
  const actionStatus = String(
    candidateRecord.actionStatus || candidateRecord.status || "",
  ).toLowerCase();
  if (actionStatus === "blocked" || actionStatus === "skipped") return "blocked";
  if (candidateRecord.reason) return "blocked";
  return "ready";
};

export const isHistoricalSignalRow = (row) =>
  String(asRecord(asRecord(row).signal).sourceType || "") === "signal_monitor_event";

export const signalTableFilterMatches = (row, filter) => {
  if (filter === "all") return true;
  if (filter === "current") return !isHistoricalSignalRow(row);
  if (filter === "history") return isHistoricalSignalRow(row);
  return row.classification === filter;
};

const normalizeSearchText = (value) => String(value || "").trim().toUpperCase();

const rowSearchText = (row) => {
  const signal = asRecord(row.signal);
  const candidate = asRecord(row.candidate);
  const previewContract = asRecord(signalContractPreview(signal).selectedContract);
  return [
    signal.symbol,
    candidate.symbol,
    previewContract.ticker,
    previewContract.expirationDate,
    previewContract.strike,
    signal.strategyLabel,
    candidate.strategyLabel,
    candidate.sourceType,
    candidate.source,
    signal.timeframe,
    candidate.timeframe,
    row.auditProgression?.searchText,
  ]
    .map(normalizeSearchText)
    .filter(Boolean)
    .join(" ");
};

const rowMatrixSymbols = (rows = []) => {
  const seen = new Set();
  const symbols = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const symbol = String(asRecord(asRecord(row).signal).symbol || "")
      .trim()
      .toUpperCase();
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    symbols.push(symbol);
  });
  return symbols;
};

export const buildAlgoSignalMatrixHydrationRequest = ({
  rows = [],
  pageRows = [],
  currentStates = [],
  timeframes,
} = {}) => {
  const symbols = rowMatrixSymbols(rows);
  if (!symbols.length) return null;

  const matrixHydrationPlan = buildSignalsMatrixHydrationPlan({
    symbols,
    prioritySymbols: rowMatrixSymbols(pageRows),
    currentStates,
    timeframes,
  });

  if (
    !matrixHydrationPlan.symbols.length ||
    !matrixHydrationPlan.missingSymbols.length
  ) {
    return null;
  }

  return {
    symbols: matrixHydrationPlan.symbols,
    prioritySymbols: matrixHydrationPlan.requestSymbols,
    missingSymbols: matrixHydrationPlan.missingSymbols,
    requestSymbols: matrixHydrationPlan.requestSymbols,
    timeframes: matrixHydrationPlan.timeframes,
    clientRole: "algo-sta",
    requestOrigin: "sta-visible-page",
    reason: "algo-signal-table",
  };
};

export const sortRows = (
  rows,
  sortKey,
  focusedSymbol = null,
  sortDirection = defaultSortDirection(sortKey),
) => {
  const focused = String(focusedSymbol || "").toUpperCase();
  const copy = [...rows];
  const isFocused = (row) =>
    focused &&
    String(row.signal.symbol || "").toUpperCase() === focused;
  const fallbackCompare = (a, b) =>
    compareTimestampValues(signalTimestampMs(a.signal), signalTimestampMs(b.signal), "desc") ||
    compareTimestampValues(rowActivityTimestampMs(a), rowActivityTimestampMs(b), "desc") ||
    compareTextValues(a.signal.symbol, b.signal.symbol, "asc");
  const baseCompare = (a, b) => {
    if (sortKey === "symbol") {
      return (
        compareTextValues(a.signal.symbol, b.signal.symbol, sortDirection) ||
        fallbackCompare(a, b)
      );
    }
    if (sortKey === "bars") {
      return compareFiniteValues(
        sortNumberOrNaN(a.signal.barsSinceSignal),
        sortNumberOrNaN(b.signal.barsSinceSignal),
        sortDirection,
      ) || fallbackCompare(a, b);
    }
    if (sortKey === "move") {
      return (
        compareFiniteValues(
          signalMoveSortValue(a),
          signalMoveSortValue(b),
          sortDirection,
        ) || fallbackCompare(a, b)
      );
    }
    if (sortKey === "quoteAge") {
      return (
        compareFiniteValues(
          quoteAgeSortValue(rowMetricCandidate(a)),
          quoteAgeSortValue(rowMetricCandidate(b)),
          sortDirection,
        ) || fallbackCompare(a, b)
      );
    }
    if (sortKey === "spread") {
      return (
        compareFiniteValues(
          spreadSortValue(rowMetricCandidate(a)),
          spreadSortValue(rowMetricCandidate(b)),
          sortDirection,
        ) || fallbackCompare(a, b)
      );
    }
    if (sortKey === "score") {
      return compareFiniteValues(
        scoreSortValue(a.scoreBreakdown),
        scoreSortValue(b.scoreBreakdown),
        sortDirection,
      ) || fallbackCompare(a, b);
    }
    if (sortKey === "latest") {
      return (
        compareTimestampValues(
          rowActivityTimestampMs(a),
          rowActivityTimestampMs(b),
          sortDirection,
        ) || fallbackCompare(a, b)
      );
    }
    return compareTimestampValues(
      signalTimestampMs(a.signal),
      signalTimestampMs(b.signal),
      sortDirection,
    ) || fallbackCompare(a, b);
  };
  copy.sort((a, b) => {
    if (focused) {
      const aFocused = isFocused(a);
      const bFocused = isFocused(b);
      if (aFocused && !bFocused) return -1;
      if (!aFocused && bFocused) return 1;
    }
    return baseCompare(a, b);
  });
  return copy;
};

const columnControlButtonStyle = (active = false, tone = CSS_COLOR.textDim) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: sp(4),
  minWidth: dim(26),
  height: dim(26),
  padding: sp("0 7px"),
  borderRadius: dim(RADII.sm),
  border: `1px solid ${active ? tone : CSS_COLOR.border}`,
  background: active ? cssColorAlpha(tone, "1c") : CSS_COLOR.bg2,
  color: active ? CSS_COLOR.text : CSS_COLOR.textDim,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  cursor: "pointer",
});

const iconOnlyButtonStyle = (disabled = false) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: dim(24),
  height: dim(24),
  borderRadius: dim(RADII.sm),
  border: `1px solid ${CSS_COLOR.border}`,
  background: CSS_COLOR.bg2,
  color: disabled ? CSS_COLOR.textMuted : CSS_COLOR.textDim,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.45 : 1,
});

const SortableSignalColumnRow = ({
  checked,
  column,
  columnId,
  index,
  locked,
  onMove,
  onToggle,
  totalCount,
}) => {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: columnId });

  return (
    <div
      ref={setNodeRef}
      data-testid={`algo-signal-column-row-${columnId}`}
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
        alignItems: "center",
        gap: sp(4),
        padding: sp("5px 6px"),
        border: `1px solid ${checked ? CSS_COLOR.borderLight : CSS_COLOR.border}`,
        background: checked ? CSS_COLOR.bg1 : CSS_COLOR.bg0,
        boxShadow: isDragging ? `0 12px 28px ${cssColorMix(CSS_COLOR.bg0, 58)}` : "none",
        opacity: isDragging ? 0.78 : 1,
        position: "relative",
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 2 : "auto",
      }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Drag ${column.label} column`}
        title="Drag to reorder"
        data-testid={`algo-signal-column-drag-${columnId}`}
        style={{
          ...iconOnlyButtonStyle(false),
          width: dim(22),
          cursor: isDragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} strokeWidth={1.9} aria-hidden="true" />
      </button>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sp(6),
          minWidth: 0,
          color: checked ? CSS_COLOR.text : CSS_COLOR.textDim,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          cursor: locked ? "default" : "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={() => onToggle(columnId)}
        />
        <span
          title={column.toggleLabel || column.label}
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {column.toggleLabel || column.label}
        </span>
      </label>
      <button
        type="button"
        disabled={index === 0}
        aria-label={`Move ${column.label} column up`}
        title="Move up"
        onClick={() => onMove(columnId, -1)}
        style={iconOnlyButtonStyle(index === 0)}
      >
        <ArrowUp size={13} strokeWidth={1.9} aria-hidden="true" />
      </button>
      <button
        type="button"
        disabled={index === totalCount - 1}
        aria-label={`Move ${column.label} column down`}
        title="Move down"
        onClick={() => onMove(columnId, 1)}
        style={iconOnlyButtonStyle(index === totalCount - 1)}
      >
        <ArrowDown size={13} strokeWidth={1.9} aria-hidden="true" />
      </button>
    </div>
  );
};

const OperationsSignalColumnDrawer = ({
  columnOrder,
  visibleColumnIds,
  onClose,
  onMove,
  onReorder,
  onReset,
  onToggle,
}) => {
  const visibleSet = new Set(visibleColumnIds);
  const lockedSet = new Set(ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleDragEnd = ({ active, over }) => {
    const activeId = String(active?.id || "");
    const overId = String(over?.id || "");
    if (!activeId || !overId || activeId === overId) return;
    onReorder(activeId, overId);
  };

  return (
    <div
      id="algo-signal-column-drawer"
      data-testid="algo-signal-column-drawer"
      style={{
        width: "min(100%, 360px)",
        marginTop: sp(2),
        padding: sp("8px 10px"),
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.sm),
        background: CSS_COLOR.bg2,
        boxShadow: `0 18px 48px ${cssColorMix(CSS_COLOR.bg0, 60)}`,
        display: "grid",
        gap: sp(7),
        justifySelf: "end",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
        }}
      >
        <div style={{ display: "grid", gap: sp(1), minWidth: 0 }}>
          <span
            style={{
              color: CSS_COLOR.text,
              fontFamily: T.sans,
              fontSize: fs(11),
              fontWeight: 600,
            }}
          >
            Columns
          </span>
          <span
            style={{
              color: CSS_COLOR.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
            }}
          >
            Show, hide, and order signal fields.
          </span>
        </div>
        <button
          type="button"
          aria-label="Close signal column drawer"
          title="Close columns"
          onClick={onClose}
          style={iconOnlyButtonStyle(false)}
        >
          <X size={13} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={columnOrder} strategy={verticalListSortingStrategy}>
          <div data-testid="algo-signal-column-sortable-list" style={{ display: "grid", gap: sp(4) }}>
            {columnOrder.map((columnId, index) => {
              const column = SIGNAL_COLUMN_BY_KEY.get(columnId);
              if (!column) return null;
              const checked = visibleSet.has(columnId);
              const locked = lockedSet.has(columnId);
              return (
                <SortableSignalColumnRow
                  key={columnId}
                  checked={checked}
                  column={column}
                  columnId={columnId}
                  index={index}
                  locked={locked}
                  onMove={onMove}
                  onToggle={onToggle}
                  totalCount={columnOrder.length}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <button
        type="button"
        onClick={onReset}
        style={{ ...columnControlButtonStyle(false), justifySelf: "start" }}
      >
        <RotateCcw size={13} strokeWidth={1.8} aria-hidden="true" />
        <span>Reset</span>
      </button>
    </div>
  );
};

export const OperationsSignalTable = ({
  signals = [],
  candidates = [],
  signalOptionsSourceHealth = null,
  signalMatrixStates = [],
  cockpitGeneratedAt = null,
  cockpitStageItems = [],
  events = [],
  algoIsPhone,
  algoIsNarrow = false,
  safeQaMode = false,
  backgroundQueriesEnabled = false,
  rowHydrationQueriesEnabled = false,
  onRequestSignalMatrixHydration = null,
  onOpenCandidateInTrade,
}) => {
  const [filter, setFilter] = useState("all");
  const [sortState, setSortState] = useState({
    key: "newest",
    direction: defaultSortDirection("newest"),
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnOrder, setColumnOrder] = useState(() =>
    resolveInitialSignalColumnOrder(),
  );
  const [visibleColumnIds, setVisibleColumnIds] = useState(() =>
    resolveInitialSignalVisibleColumns(),
  );
  const sortKey = sortState.key;
  const sortDirection = sortState.direction;
  const visibleColumns = useMemo(
    () =>
      normalizeSignalColumnOrder(columnOrder)
        .map((columnId) => SIGNAL_COLUMN_BY_KEY.get(columnId))
        .filter((column) => column && visibleColumnIds.includes(column.key)),
    [columnOrder, visibleColumnIds],
  );
  const tableMinWidth = useMemo(
    () => signalTableMinWidth(visibleColumns),
    [visibleColumns],
  );
  const providerContractIds = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...(candidates || []).map((candidate) =>
              optionProviderContractId(asRecord(candidate).selectedContract),
            ),
            ...(signals || []).map((signal) =>
              optionProviderContractId(
                asRecord(signalContractPreview(signal).selectedContract),
              ),
            ),
          ].filter(Boolean),
        ),
      ),
    [candidates, signals],
  );
  useStoredOptionQuoteSnapshotVersion(providerContractIds);
  const signalMatrixBySymbol = useMemo(
    () => buildSignalMatrixBySymbol(signalMatrixStates, SIGNALS_TABLE_TIMEFRAMES),
    [signalMatrixStates],
  );
  const rows = useMemo(() => {
    const augmented = (signals || []).map((signal) => {
      const candidate = findSignalOptionsCandidateForSignal(candidates, signal);
      return {
        auditKey: signalAuditRowKey(signal, candidate),
        signal,
        candidate,
        classification: classifySignal(signal, candidate),
        scoreBreakdown: resolveSignalScoreBreakdown({ signal, candidate }),
      };
    });
    const auditProgressions = buildSignalAuditProgressions({
      events,
      rows: augmented,
    });
    const withProgression = augmented.map((row) => ({
      ...row,
      auditProgression: auditProgressions.get(row.auditKey) || null,
    }));
    const filteredByStatus = withProgression.filter((row) =>
      signalTableFilterMatches(row, filter),
    );
    const normalizedQuery = normalizeSearchText(searchQuery);
    const filtered = normalizedQuery
      ? filteredByStatus.filter((row) => rowSearchText(row).includes(normalizedQuery))
      : filteredByStatus;
    return sortRows(filtered, sortKey, null, sortDirection);
  }, [
    candidates,
    events,
    filter,
    searchQuery,
    signals,
    sortDirection,
    sortKey,
  ]);
  const paginatedRows = useMemo(
    () => paginateRows(rows, page, SIGNALS_PAGE_SIZE),
    [page, rows],
  );
  const pageRows = paginatedRows.pageRows;
  const signalMatrixHydrationRequest = useMemo(
    () =>
      buildAlgoSignalMatrixHydrationRequest({
        rows,
        pageRows,
        currentStates: signalMatrixStates,
        timeframes: SIGNALS_TABLE_TIMEFRAMES,
      }),
    [pageRows, rows, signalMatrixStates],
  );
  useEffect(() => {
    if (!signalMatrixHydrationRequest) return;
    onRequestSignalMatrixHydration?.(signalMatrixHydrationRequest);
  }, [onRequestSignalMatrixHydration, signalMatrixHydrationRequest]);
  const rowSymbols = useMemo(
    () =>
      pageRows
        .map(({ signal }) => String(asRecord(signal).symbol || "").toUpperCase())
        .filter(Boolean),
    [pageRows],
  );
  const rowSymbolsKey = useMemo(() => rowSymbols.join(","), [rowSymbols]);
  const tickerSnapshotsBySymbol = useRuntimeTickerSnapshots(rowSymbols);
  const pageSignalBySymbol = useMemo(
    () =>
      Object.fromEntries(
        pageRows
          .map(({ signal }) => {
            const signalRecord = asRecord(signal);
            const symbol = String(signalRecord.symbol || "").toUpperCase();
            return symbol ? [symbol, signalRecord] : null;
          })
          .filter(Boolean),
      ),
    [pageRows],
  );
  const rowQuoteSymbols = useMemo(
    () =>
      rowSymbols.filter(
        (symbol) => !hasUsableQuoteSnapshot(tickerSnapshotsBySymbol?.[symbol]),
      ),
    [rowSymbols, tickerSnapshotsBySymbol],
  );
  const rowQuoteSymbolsKey = useMemo(() => rowQuoteSymbols.join(","), [rowQuoteSymbols]);
  const rowSparklineSymbols = useMemo(
    () =>
      rowSymbols.filter(
        (symbol) =>
          !hasUsableSparklineData(tickerSnapshotsBySymbol?.[symbol]) &&
          !hasUsableSparklineData(pageSignalBySymbol?.[symbol]),
      ),
    [pageSignalBySymbol, rowSymbols, tickerSnapshotsBySymbol],
  );
  const rowSparklineSymbolsKey = useMemo(
    () => rowSparklineSymbols.join(","),
    [rowSparklineSymbols],
  );
  const signalRowHydrationQueriesEnabled = Boolean(
    (rowHydrationQueriesEnabled || backgroundQueriesEnabled) && !safeQaMode,
  );
  const rowQuotesQuery = useGetQuoteSnapshots(
    { symbols: rowQuoteSymbolsKey },
    {
      query: {
        enabled: Boolean(signalRowHydrationQueriesEnabled && rowQuoteSymbolsKey),
        staleTime: 30_000,
        retry: false,
      },
      request: SIGNAL_TABLE_QUOTE_REQUEST_OPTIONS,
    },
  );
  const rowSparklineQuery = useQuery({
    queryKey: ["algo-signal-row-sparklines", rowSparklineSymbolsKey],
    queryFn: async () => {
      const symbols = rowSparklineSymbols;
      const results = await settleWithConcurrency(
        symbols,
        SIGNAL_TABLE_SPARKLINE_CONCURRENCY,
        (symbol) =>
          getBarsRequest(
            {
              symbol,
              timeframe: SIGNAL_TABLE_SPARKLINE_HISTORY_TIMEFRAME,
              limit: SIGNAL_TABLE_SPARKLINE_HISTORY_LIMIT,
              outsideRth: true,
              source: "trades",
            },
            SIGNAL_TABLE_SPARKLINE_REQUEST_OPTIONS,
          ),
      );

      return Object.fromEntries(
        results.map((result, index) => [
          symbols[index],
          result.status === "fulfilled"
            ? thinBarsForSignalSparkline(result.value?.bars || [])
            : [],
        ]),
      );
    },
    ...BARS_QUERY_DEFAULTS,
    enabled: Boolean(signalRowHydrationQueriesEnabled && rowSparklineSymbolsKey),
    retry: false,
    gcTime: HEAVY_PAYLOAD_GC_MS,
  });
  useEffect(() => {
    applyRuntimeQuoteSnapshots(rowQuotesQuery.data?.quotes || []);
  }, [rowQuotesQuery.dataUpdatedAt, rowQuotesQuery.data]);
  useEffect(() => {
    Object.entries(rowSparklineQuery.data || {}).forEach(([symbol, sparkBars]) => {
      if (!Array.isArray(sparkBars) || sparkBars.length < 2) return;
      publishRuntimeTickerSnapshot(symbol, symbol, { sparkBars });
    });
  }, [rowSparklineQuery.dataUpdatedAt, rowSparklineQuery.data]);
  useEffect(() => {
    setPage(0);
  }, [filter, searchQuery, sortDirection, sortKey]);
  useEffect(() => {
    if (paginatedRows.safePage !== page) {
      setPage(paginatedRows.safePage);
    }
  }, [page, paginatedRows.safePage]);
  useEffect(() => {
    persistState({
      algoSignalColumnOrder: normalizeSignalColumnOrder(columnOrder),
      algoSignalVisibleColumns: normalizeSignalVisibleColumns(visibleColumnIds),
      algoSignalColumnVisibilityVersion: SIGNAL_COLUMN_VISIBILITY_VERSION,
    });
  }, [columnOrder, visibleColumnIds]);
  useEffect(() => {
    if (algoIsPhone) setColumnsOpen(false);
  }, [algoIsPhone]);

  const counts = useMemo(() => {
    const augmented = (signals || []).map((signal) => {
      const candidate = findSignalOptionsCandidateForSignal(candidates, signal);
      return {
        signal,
        classification: classifySignal(signal, candidate),
      };
    });
    return {
      all: augmented.length,
      current: augmented.filter((row) => !isHistoricalSignalRow(row)).length,
      history: augmented.filter((row) => isHistoricalSignalRow(row)).length,
      ready: augmented.filter((row) => row.classification === "ready").length,
      blocked: augmented.filter((row) => row.classification === "blocked").length,
      unavailable: augmented.filter((row) => row.classification === "unavailable").length,
    };
  }, [candidates, signals]);

  const freshness = useMemo(() => {
    const latestSignalMs = (signals || []).reduce(
      (latest, signal) => Math.max(latest, signalTimestampMs(signal)),
      0,
    );
    const scanStage = (cockpitStageItems || []).find(
      (stage) => asRecord(stage).id === "scan_universe",
    );
    const contractStage = (cockpitStageItems || []).find(
      (stage) => asRecord(stage).id === "contract_selected",
    );
    const scanStageRecord = asRecord(scanStage);
    const contractStageRecord = asRecord(contractStage);
    const contractStageCount = Number(contractStageRecord.count);
    const contractSelectionResolved =
      Number.isFinite(contractStageCount) && contractStageCount > 0;
    const latestBarMs = timestampMs(scanStageRecord.latestSignalBarAt);
    const latestScanMs =
      timestampMs(scanStageRecord.lastSignalScanAt) ||
      timestampMs(scanStageRecord.latestAt) ||
      timestampMs(cockpitGeneratedAt);
    const pollIntervalMs = Number(scanStageRecord.pollIntervalMs);
    const staleAfterMs = Number.isFinite(pollIntervalMs)
      ? Math.max(120_000, pollIntervalMs * 2)
      : 120_000;
    const scanAgeMs = latestScanMs ? Date.now() - latestScanMs : null;
    const sourcePolicy =
      typeof scanStageRecord.signalSourcePolicy === "string" &&
      scanStageRecord.signalSourcePolicy.trim()
        ? scanStageRecord.signalSourcePolicy.trim()
        : null;
    const activePhase =
      typeof scanStageRecord.activeScanPhase === "string" &&
      scanStageRecord.activeScanPhase.trim()
        ? scanStageRecord.activeScanPhase.trim()
        : null;
    const pressureLevel =
      typeof scanStageRecord.resourcePressureLevel === "string" &&
      scanStageRecord.resourcePressureLevel.trim()
        ? scanStageRecord.resourcePressureLevel.trim()
        : null;
    const pressurePaused = scanStageRecord.pressurePaused === true;
    const pressureBlocksWork =
      pressurePaused ||
      (scanStageRecord.heavyWorkDeferred === true &&
        pressureLevelBlocksActionWork(pressureLevel));
    const heavyWorkDeferred =
      scanStageRecord.heavyWorkDeferred === true &&
      (!contractSelectionResolved || pressureBlocksWork);
    return {
      latestSignalAt: latestSignalMs ? new Date(latestSignalMs).toISOString() : null,
      latestBarAt: latestBarMs ? new Date(latestBarMs).toISOString() : null,
      latestScanAt: latestScanMs ? new Date(latestScanMs).toISOString() : null,
      scanRunning: scanStageRecord.status === "running",
      scanPhase: activePhase,
      sourcePolicy,
      heavyWorkDeferred,
      pressureLevel: pressureBlocksWork ? pressureLevel : null,
      staleScan:
        Boolean(latestScanMs) &&
        scanStageRecord.status !== "running" &&
        scanAgeMs !== null &&
        scanAgeMs > staleAfterMs,
      scanDetail:
        typeof scanStageRecord.detail === "string" && scanStageRecord.detail.trim()
          ? scanStageRecord.detail.trim()
          : null,
    };
  }, [cockpitGeneratedAt, cockpitStageItems, signals]);

  const sourceHealth = asRecord(signalOptionsSourceHealth);
  const sourceHealthLabel =
    sourceHealth.degraded || sourceHealth.stale
      ? "Action source cached"
      : sourceHealth.source && sourceHealth.source !== "empty"
        ? `Action ${formatCompactStatusValue(sourceHealth.source)}`
        : null;
  const freshnessItems = [
    freshness.latestSignalAt
      ? `Signal ${formatRelativeTimeShort(freshness.latestSignalAt)}`
      : "Signal --",
    freshness.latestBarAt
      ? `Bar ${formatRelativeTimeShort(freshness.latestBarAt)}`
      : "Bar --",
    freshness.scanRunning
      ? "Scan running"
      : freshness.scanDetail
        ? freshness.scanDetail
        : freshness.latestScanAt
        ? `Scan ${formatRelativeTimeShort(freshness.latestScanAt)}`
        : "Scan --",
    freshness.sourcePolicy
      ? formatCompactStatusValue(freshness.sourcePolicy)
      : "Source --",
    sourceHealthLabel,
    freshness.pressureLevel ? "Action scan queued" : null,
  ];
  const staleScanBanner =
    freshness.pressureLevel || freshness.staleScan
      ? [
          freshness.pressureLevel
            ? "Signal action scan is queued by resource pressure."
            : "Signal scan freshness is outside the expected window.",
          freshness.latestScanAt
            ? `Last scan ${formatRelativeTimeShort(freshness.latestScanAt)}.`
            : null,
          freshness.latestBarAt
            ? `Latest bar ${formatRelativeTimeShort(freshness.latestBarAt)}.`
            : null,
          freshness.pressureLevel
            ? `Pressure ${formatCompactStatusValue(freshness.pressureLevel)}.`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : null;
  const sourceHealthBanner =
    sourceHealth.degraded || sourceHealth.stale
      ? [
          "STA action source is using the last successful snapshot.",
          Array.isArray(sourceHealth.failedSources) && sourceHealth.failedSources.length
            ? `Failed source ${sourceHealth.failedSources
                .map(formatCompactStatusValue)
                .join(", ")}.`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : null;
  const activeFilter = FILTER_OPTIONS.find((option) => option.id === filter) || FILTER_OPTIONS[0];
  const compactTools = algoIsPhone || algoIsNarrow;
  const signalTableCompact = false;
  const freshnessLine = freshnessItems.filter(Boolean).join(" · ");
  const statusLine = `${activeFilter.label} ${rows.length} of ${counts.all} signals · ${freshnessLine}`;
  const mobileStatusLine = `${activeFilter.label} ${rows.length}/${counts.all} · ${freshnessLine}`;
  const signalScanWave = resolveSignalScanWave(freshness);
  const sortSummary = `Sorted by ${SORT_LABELS[sortKey] || "Newest"} ${
    SORT_DIRECTION_LABELS[sortDirection] || "descending"
  } · ${rows.length} rows`;
  const compactSortValue = `${sortKey}:${sortDirection}`;
  const compactSortOptions = COMPACT_SORT_OPTIONS.some(
    (option) => option.value === compactSortValue,
  )
    ? COMPACT_SORT_OPTIONS
    : [
        {
          value: compactSortValue,
          label: SORT_LABELS[sortKey] || "Current",
        },
        ...COMPACT_SORT_OPTIONS,
      ];
  const handleSortChange = (nextSortKey) => {
    setSortState((current) => ({
      key: nextSortKey,
      direction:
        current.key === nextSortKey
          ? toggleSortDirection(current.direction)
          : defaultSortDirection(nextSortKey),
    }));
  };
  const handleCompactSortChange = (value) => {
    const [nextSortKey, nextDirection] = String(value || "").split(":");
    if (!nextSortKey || !nextDirection) return;
    setSortState({ key: nextSortKey, direction: nextDirection });
  };
  const toggleColumn = (columnId) => {
    if (ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS.includes(columnId)) return;
    setVisibleColumnIds((current) => {
      const currentSet = new Set(normalizeSignalVisibleColumns(current));
      if (currentSet.has(columnId)) {
        currentSet.delete(columnId);
      } else {
        currentSet.add(columnId);
      }
      ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS.forEach((lockedId) => currentSet.add(lockedId));
      return normalizeSignalColumnOrder(columnOrder).filter((id) => currentSet.has(id));
    });
  };
  const moveColumn = (columnId, direction) => {
    setColumnOrder((current) => {
      const next = normalizeSignalColumnOrder(current);
      const index = next.indexOf(columnId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= next.length) return next;
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };
  const reorderColumn = (activeColumnId, overColumnId) => {
    if (activeColumnId === "rowAction" || overColumnId === "rowAction") return;
    setColumnOrder((current) => {
      const next = normalizeSignalColumnOrder(current);
      const activeIndex = next.indexOf(activeColumnId);
      const overIndex = next.indexOf(overColumnId);
      if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return next;
      return arrayMove(next, activeIndex, overIndex);
    });
  };
  const resetColumns = () => {
    setColumnOrder(DEFAULT_SIGNAL_COLUMN_ORDER);
    setVisibleColumnIds(DEFAULT_SIGNAL_VISIBLE_COLUMNS);
  };
  const handleRowAction = ({ actionId, candidate }) => {
    if (
      (actionId === "submit" || actionId === "openTrade") &&
      candidate &&
      onOpenCandidateInTrade
    ) {
      onOpenCandidateInTrade(candidate);
    }
  };

  return (
    <div
      data-testid="algo-operations-signal-table"
      style={{
        background: CSS_COLOR.bg1,
        border: algoIsPhone ? 0 : `1px solid ${CSS_COLOR.border}`,
        borderTop: algoIsPhone ? `1px solid ${CSS_COLOR.border}` : undefined,
        borderBottom: algoIsPhone ? `1px solid ${CSS_COLOR.border}` : undefined,
        borderRadius: algoIsPhone ? 0 : dim(RADII.md),
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "grid",
          gap: sp(algoIsPhone ? 3 : 6),
          padding: algoIsPhone ? sp("4px 6px") : sp("6px 10px"),
          borderBottom: `1px solid ${CSS_COLOR.border}`,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: sp(1),
            flex: "0 0 auto",
            minWidth: 0,
          }}
        >
          <span
            title={[
              freshness.latestSignalAt
                ? `Latest signal ${freshness.latestSignalAt}`
                : null,
              freshness.latestBarAt ? `Latest bar ${freshness.latestBarAt}` : null,
              freshness.latestScanAt ? `Latest scan ${freshness.latestScanAt}` : null,
              freshness.sourcePolicy
                ? `Source ${formatCompactStatusValue(freshness.sourcePolicy)}`
                : null,
              freshness.scanPhase
                ? `Phase ${formatCompactStatusValue(freshness.scanPhase)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            style={{
              color: CSS_COLOR.text,
              display: "flex",
              alignItems: "center",
              gap: sp(4),
              fontFamily: T.sans,
              fontSize: fs(algoIsPhone ? 10 : 12),
              fontWeight: 600,
              lineHeight: 1.1,
              minWidth: 0,
            }}
          >
            <IbkrStatusWave
              status={signalScanWave.status}
              wave={signalScanWave.wave}
              color={signalScanWave.color}
              width={algoIsPhone ? 22 : 28}
              height={12}
              decorative={false}
              ariaLabel="Signal scan activity"
              dataTestId="algo-signal-scan-wave"
            />
            <span
              style={{
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {algoIsPhone ? `Signals · ${mobileStatusLine}` : `Signals to Actions · ${statusLine}`}
            </span>
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: sp(algoIsPhone ? 4 : 6),
            alignItems: "center",
            flexWrap: algoIsPhone ? "wrap" : "nowrap",
            color: CSS_COLOR.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
            minWidth: 0,
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(4),
              flex: algoIsPhone ? "1 1 100%" : "1 1 220px",
              minWidth: compactTools ? 0 : dim(180),
              maxWidth: compactTools ? "100%" : dim(280),
              height: dim(algoIsPhone ? 24 : 26),
              padding: algoIsPhone ? sp("0 6px") : sp("0 8px"),
              borderRadius: dim(RADII.sm),
              border: `1px solid ${CSS_COLOR.border}`,
              background: CSS_COLOR.bg2,
              color: CSS_COLOR.textMuted,
            }}
          >
            <Search size={13} strokeWidth={1.8} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={algoIsPhone ? "Search" : "Symbol or strategy"}
              aria-label="Search signals by symbol or strategy"
              style={{
                width: "100%",
                minWidth: 0,
                border: 0,
                outline: 0,
                background: "transparent",
                color: CSS_COLOR.text,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
              }}
            />
          </label>
          {compactTools ? (
            <select
              aria-label="Filter signals"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              style={{
                height: dim(algoIsPhone ? 24 : 26),
                flex: algoIsPhone ? "1 1 calc(50% - 4px)" : "0 0 auto",
                maxWidth: algoIsPhone ? "none" : dim(132),
                borderRadius: dim(RADII.sm),
                border: `1px solid ${CSS_COLOR.border}`,
                background: CSS_COLOR.bg2,
                color: CSS_COLOR.text,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
              }}
            >
              {FILTER_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} {counts[option.id] ?? 0}
                </option>
              ))}
            </select>
          ) : (
            FILTER_OPTIONS.map((option) => {
              const active = filter === option.id;
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setFilter(option.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: sp(3),
                    flex: "0 0 auto",
                    padding: sp("2px 8px"),
                    borderRadius: dim(RADII.pill),
                    border: `1px solid ${active ? option.tone : CSS_COLOR.border}`,
                    background: active ? cssColorAlpha(option.tone, "1c") : "transparent",
                    color: active ? CSS_COLOR.text : CSS_COLOR.textDim,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    cursor: "pointer",
                  }}
                >
                  {Icon ? (
                    <Icon
                      size={12}
                      strokeWidth={1.8}
                      aria-hidden="true"
                      style={{ color: active ? option.tone : CSS_COLOR.textMuted }}
                    />
                  ) : null}
                  <span>{option.label}</span>
                  <span style={{ color: active ? option.tone : CSS_COLOR.textMuted }}>
                    {counts[option.id] ?? 0}
                  </span>
                </button>
              );
            })
          )}
          {algoIsPhone ? (
            <select
              aria-label="Sort signals"
              value={compactSortValue}
              onChange={(event) => handleCompactSortChange(event.target.value)}
              style={{
                height: dim(24),
                flex: "1 1 calc(50% - 4px)",
                maxWidth: "none",
                borderRadius: dim(RADII.sm),
                border: `1px solid ${CSS_COLOR.border}`,
                background: CSS_COLOR.bg2,
                color: CSS_COLOR.text,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
              }}
            >
              {compactSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : null}
          {!algoIsPhone ? (
            <button
              type="button"
              aria-expanded={columnsOpen}
              aria-controls="algo-signal-column-drawer"
              title="Choose signal table columns"
              onClick={() => setColumnsOpen((value) => !value)}
              style={columnControlButtonStyle(columnsOpen, CSS_COLOR.accent)}
            >
              <Columns3 size={13} strokeWidth={1.8} aria-hidden="true" />
              <span>Columns</span>
              <span style={{ color: columnsOpen ? CSS_COLOR.accent : CSS_COLOR.textMuted }}>
                {visibleColumns.length}
              </span>
            </button>
          ) : null}
          {!algoIsPhone ? (
            <span
              style={{
                flex: "0 0 auto",
                color: CSS_COLOR.textMuted,
                whiteSpace: "nowrap",
              }}
            >
              {sortSummary}
            </span>
          ) : null}
        </div>
        {staleScanBanner || sourceHealthBanner ? (
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: sp(5),
              minWidth: 0,
              padding: sp("5px 7px"),
              borderRadius: dim(RADII.sm),
              border: `1px solid ${cssColorAlpha(CSS_COLOR.amber, "66")}`,
              background: cssColorAlpha(CSS_COLOR.amber, "14"),
              color: CSS_COLOR.text,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
              lineHeight: 1.25,
            }}
          >
            <AlertTriangle
              size={13}
              strokeWidth={1.8}
              aria-hidden="true"
              style={{ color: CSS_COLOR.amber, flex: "0 0 auto" }}
            />
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: algoIsPhone ? "normal" : "nowrap",
              }}
            >
              {[staleScanBanner, sourceHealthBanner].filter(Boolean).join(" ")}
            </span>
          </div>
        ) : null}
        {columnsOpen && !algoIsPhone ? (
          <OperationsSignalColumnDrawer
            columnOrder={columnOrder}
            visibleColumnIds={visibleColumnIds}
            onClose={() => setColumnsOpen(false)}
            onMove={moveColumn}
            onReorder={reorderColumn}
            onReset={resetColumns}
            onToggle={toggleColumn}
          />
        ) : null}
      </div>

      <div
        data-testid="algo-signal-table-scroll"
        className="ra-dense-table-scroll"
        style={{
          overflowX: "auto",
          overflowY: signalTableCompact ? "visible" : "auto",
          maxHeight: signalTableCompact ? "none" : 520,
          minWidth: 0,
        }}
      >
        <div
          data-testid="algo-signal-table-rail"
          style={{ minWidth: signalTableCompact ? 0 : tableMinWidth }}
        >
          {!signalTableCompact ? (
            <OperationsSignalTableHeader
              columns={visibleColumns}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onColumnReorder={reorderColumn}
              onSortChange={handleSortChange}
            />
          ) : null}

          <div
            data-testid="algo-signal-table-body"
            style={{
              minWidth: 0,
              overflow: "visible",
            }}
          >
            {rows.length === 0 ? (
              <div style={{ padding: sp(6) }}>
                <DataUnavailableState
                  title={
                    searchQuery.trim()
                      ? "No signals match this search"
                      : filter === "all"
                      ? "Awaiting next scan"
                      : "No signals match this filter"
                  }
                  detail={
                    searchQuery.trim()
                      ? "Clear search to return to the current signal list."
                      : filter === "all"
                      ? "Signals appear as soon as the monitor finishes its next pass."
                      : "Switch filter to All to see signals in other states."
                  }
                  icon={<Inbox size={20} strokeWidth={1.8} aria-hidden="true" />}
                  minHeight={56}
                  loading={filter === "all" && !searchQuery.trim()}
                />
              </div>
            ) : (
              pageRows.map(({ signal, candidate, scoreBreakdown, auditProgression }, rowIndex) => {
                const symbol = asRecord(signal).symbol;
                return (
                  <OperationsSignalRow
                    key={asRecord(signal).signalKey || symbol}
                    signal={signal}
                    candidate={candidate}
                    auditProgression={auditProgression}
                    scoreBreakdown={scoreBreakdown}
                    tfMatrix={signalMatrixBySymbol?.[String(symbol || "").toUpperCase()] || null}
                    timeframes={SIGNALS_TABLE_TIMEFRAMES}
                    tickerSnapshot={
                      tickerSnapshotsBySymbol?.[String(symbol || "").toUpperCase()] || null
                    }
                    alt={rowIndex % 2 === 1}
                    columns={visibleColumns}
                    compact={signalTableCompact}
                    scanActive={freshness.scanRunning}
                    onRowAction={handleRowAction}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
      <PaginationFooter
        dataTestId="algo-signals-pagination"
        label="Rows"
        onPageChange={setPage}
        page={paginatedRows.safePage}
        pageCount={paginatedRows.pageCount}
        pageSize={SIGNALS_PAGE_SIZE}
        total={paginatedRows.total}
        style={{
          padding: algoIsPhone ? sp("4px 6px") : sp("6px 10px"),
          borderTop: `1px solid ${CSS_COLOR.border}`,
        }}
      />
    </div>
  );
};

export default OperationsSignalTable;
