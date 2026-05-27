import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  Columns3,
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
import {
  algoFocusStore,
  clearAlgoFocus,
  setAlgoFocus,
  useAlgoFocus,
} from "../../features/platform/algoFocusStore";
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";
import { PaginationFooter, paginateRows } from "../../components/platform/TablePagination.jsx";
import { useStoredOptionQuoteSnapshotVersion } from "../../features/platform/live-streams";
import { useRuntimeTickerSnapshots } from "../../features/platform/runtimeTickerStore";
import { buildSignalMatrixBySymbol } from "../../features/platform/watchlistModel";
import { _initialState, persistState } from "../../lib/workspaceState";
import {
  asRecord,
  findSignalOptionsCandidateForSignal,
  optionProviderContractId,
  resolveSignalScoreBreakdown,
} from "./algoHelpers";
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
  { id: "ready", label: "Ready", icon: CheckCircle2, tone: CSS_COLOR.green },
  { id: "blocked", label: "Blocked", icon: Ban, tone: CSS_COLOR.red },
  { id: "unavailable", label: "Unavailable", icon: MinusCircle, tone: CSS_COLOR.textDim },
];

const SIGNALS_PAGE_SIZE = 30;

const SORT_LABELS = {
  newest: "Newest",
  symbol: "Symbol",
  bars: "Bars",
  move: "Move",
  quoteAge: "Quote",
  spread: "Spread",
  score: "Score",
  latest: "Decision",
};

const SORT_DIRECTION_LABELS = {
  asc: "ascending",
  desc: "descending",
};

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

const timestampMs = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
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

const positiveSortNumberOrNaN = (value) => {
  const number = sortNumberOrNaN(value);
  return number > 0 ? number : Number.NaN;
};

const firstFiniteSortNumber = (...values) => {
  for (const value of values) {
    const number = sortNumberOrNaN(value);
    if (Number.isFinite(number)) return number;
  }
  return Number.NaN;
};

const signalMoveSortValue = (row) => {
  const signal = asRecord(row.signal);
  const candidate = asRecord(row.candidate);
  const signalPrice = positiveSortNumberOrNaN(signal.signalPrice);
  const currentPrice = firstFiniteSortNumber(
    signal.currentPrice,
    signal.last,
    signal.mark,
    candidate.underlyingPrice,
    candidate.currentPrice,
  );
  if (!Number.isFinite(signalPrice) || !Number.isFinite(currentPrice)) {
    return Number.NaN;
  }
  return ((currentPrice - signalPrice) / signalPrice) * 100;
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

const classifySignal = (signal, candidate) => {
  if (signal?.status === "unavailable") return "unavailable";
  if (candidate?.actionStatus === "blocked" || candidate?.status === "blocked") {
    return "blocked";
  }
  if (candidate?.reason) return "blocked";
  return "ready";
};

const normalizeSearchText = (value) => String(value || "").trim().toUpperCase();

const rowSearchText = (row) => {
  const signal = asRecord(row.signal);
  const candidate = asRecord(row.candidate);
  return [
    signal.symbol,
    candidate.symbol,
    signal.strategyLabel,
    candidate.strategyLabel,
    candidate.sourceType,
    candidate.source,
    signal.timeframe,
    candidate.timeframe,
  ]
    .map(normalizeSearchText)
    .filter(Boolean)
    .join(" ");
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
          quoteAgeSortValue(a.candidate),
          quoteAgeSortValue(b.candidate),
          sortDirection,
        ) || fallbackCompare(a, b)
      );
    }
    if (sortKey === "spread") {
      return (
        compareFiniteValues(
          spreadSortValue(a.candidate),
          spreadSortValue(b.candidate),
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

const OperationsSignalColumnDrawer = ({
  columnOrder,
  visibleColumnIds,
  onClose,
  onMove,
  onReset,
  onToggle,
}) => {
  const visibleSet = new Set(visibleColumnIds);
  const lockedSet = new Set(ALWAYS_VISIBLE_SIGNAL_COLUMN_IDS);
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

      <div style={{ display: "grid", gap: sp(4) }}>
        {columnOrder.map((columnId, index) => {
          const column = SIGNAL_COLUMN_BY_KEY.get(columnId);
          if (!column) return null;
          const checked = visibleSet.has(columnId);
          const locked = lockedSet.has(columnId);
          return (
            <div
              key={columnId}
              data-testid={`algo-signal-column-row-${columnId}`}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto auto",
                alignItems: "center",
                gap: sp(4),
                padding: sp("5px 6px"),
                border: `1px solid ${checked ? CSS_COLOR.borderLight : CSS_COLOR.border}`,
                background: checked ? CSS_COLOR.bg1 : CSS_COLOR.bg0,
              }}
            >
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
                disabled={index === columnOrder.length - 1}
                aria-label={`Move ${column.label} column down`}
                title="Move down"
                onClick={() => onMove(columnId, 1)}
                style={iconOnlyButtonStyle(index === columnOrder.length - 1)}
              >
                <ArrowDown size={13} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

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
  signalMatrixStates = [],
  cockpitGeneratedAt = null,
  cockpitStageItems = [],
  algoIsPhone,
  algoIsNarrow = false,
  onOpenCandidateInTrade,
  renderDrill,
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
    normalizeSignalColumnOrder(_initialState.algoSignalColumnOrder),
  );
  const [visibleColumnIds, setVisibleColumnIds] = useState(() =>
    normalizeSignalVisibleColumns(_initialState.algoSignalVisibleColumns),
  );
  const focus = useAlgoFocus();
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
          (candidates || [])
            .map((candidate) =>
              optionProviderContractId(asRecord(candidate).selectedContract),
            )
            .filter(Boolean),
        ),
      ),
    [candidates],
  );
  useStoredOptionQuoteSnapshotVersion(providerContractIds);
  const signalMatrixBySymbol = useMemo(
    () => buildSignalMatrixBySymbol(signalMatrixStates),
    [signalMatrixStates],
  );
  const rows = useMemo(() => {
    const augmented = (signals || []).map((signal) => {
      const candidate = findSignalOptionsCandidateForSignal(candidates, signal);
      return {
        signal,
        candidate,
        classification: classifySignal(signal, candidate),
        scoreBreakdown: resolveSignalScoreBreakdown({ signal, candidate }),
      };
    });
    const filteredByStatus =
      filter === "all"
        ? augmented
        : augmented.filter((row) => row.classification === filter);
    const normalizedQuery = normalizeSearchText(searchQuery);
    const filtered = normalizedQuery
      ? filteredByStatus.filter((row) => rowSearchText(row).includes(normalizedQuery))
      : filteredByStatus;
    return sortRows(filtered, sortKey, focus.focusedSymbol, sortDirection);
  }, [
    candidates,
    filter,
    focus.focusedSymbol,
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
  const rowSymbols = useMemo(
    () =>
      pageRows
        .map(({ signal }) => String(asRecord(signal).symbol || "").toUpperCase())
        .filter(Boolean),
    [pageRows],
  );
  const tickerSnapshotsBySymbol = useRuntimeTickerSnapshots(rowSymbols);
  useEffect(() => {
    setPage(0);
  }, [filter, focus.focusedSymbol, searchQuery, sortDirection, sortKey]);
  useEffect(() => {
    if (paginatedRows.safePage !== page) {
      setPage(paginatedRows.safePage);
    }
  }, [page, paginatedRows.safePage]);
  useEffect(() => {
    persistState({
      algoSignalColumnOrder: normalizeSignalColumnOrder(columnOrder),
      algoSignalVisibleColumns: normalizeSignalVisibleColumns(visibleColumnIds),
    });
  }, [columnOrder, visibleColumnIds]);
  useEffect(() => {
    if (algoIsPhone) setColumnsOpen(false);
  }, [algoIsPhone]);

  const counts = useMemo(() => {
    const augmented = (signals || []).map((signal) => {
      const candidate = findSignalOptionsCandidateForSignal(candidates, signal);
      return classifySignal(signal, candidate);
    });
    return {
      all: augmented.length,
      ready: augmented.filter((value) => value === "ready").length,
      blocked: augmented.filter((value) => value === "blocked").length,
      unavailable: augmented.filter((value) => value === "unavailable").length,
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
    const scanStageRecord = asRecord(scanStage);
    const latestScanMs =
      timestampMs(scanStageRecord.latestAt) || timestampMs(cockpitGeneratedAt);
    return {
      latestSignalAt: latestSignalMs ? new Date(latestSignalMs).toISOString() : null,
      latestScanAt: latestScanMs ? new Date(latestScanMs).toISOString() : null,
      scanRunning: scanStageRecord.status === "running",
      scanDetail:
        typeof scanStageRecord.detail === "string" && scanStageRecord.detail.trim()
          ? scanStageRecord.detail.trim()
          : null,
    };
  }, [cockpitGeneratedAt, cockpitStageItems, signals]);

  const freshnessItems = [
    freshness.latestSignalAt
      ? `Signal ${formatRelativeTimeShort(freshness.latestSignalAt)}`
      : "Signal --",
    freshness.scanRunning
      ? "Scan running"
      : freshness.scanDetail
        ? freshness.scanDetail
        : freshness.latestScanAt
        ? `Scan ${formatRelativeTimeShort(freshness.latestScanAt)}`
        : "Scan --",
  ];
  const activeFilter = FILTER_OPTIONS.find((option) => option.id === filter) || FILTER_OPTIONS[0];
  const compactTools = algoIsPhone || algoIsNarrow;
  const statusLine = `${activeFilter.label} ${rows.length} of ${counts.all} signals · ${freshnessItems.join(" · ")}`;
  const mobileStatusLine = `${activeFilter.label} ${rows.length}/${counts.all} · ${freshnessItems.join(" · ")}`;
  const sortSummary = `Sorted by ${SORT_LABELS[sortKey] || "Newest"} ${
    SORT_DIRECTION_LABELS[sortDirection] || "descending"
  } · ${rows.length} rows`;
  const handleSortChange = (nextSortKey) => {
    setSortState((current) => ({
      key: nextSortKey,
      direction:
        current.key === nextSortKey
          ? toggleSortDirection(current.direction)
          : defaultSortDirection(nextSortKey),
    }));
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
  const resetColumns = () => {
    setColumnOrder(DEFAULT_SIGNAL_COLUMN_ORDER);
    setVisibleColumnIds(DEFAULT_SIGNAL_VISIBLE_COLUMNS);
  };
  const handleRowAction = ({ actionId, signal, candidate }) => {
    const symbol = asRecord(signal).symbol;
    if (actionId === "submit" && candidate && onOpenCandidateInTrade) {
      onOpenCandidateInTrade(candidate);
      return;
    }
    setAlgoFocus(symbol, "action");
  };

  return (
    <div
      data-testid="algo-operations-signal-table"
      className="ra-dense-table-scroll"
      style={{
        background: CSS_COLOR.bg1,
        border: `1px solid ${CSS_COLOR.border}`,
        borderRadius: dim(RADII.md),
        overflowX: "auto",
        overflowY: "hidden",
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
              freshness.latestScanAt ? `Latest scan ${freshness.latestScanAt}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            style={{
              color: CSS_COLOR.text,
              fontFamily: T.sans,
              fontSize: fs(algoIsPhone ? 10 : 12),
              fontWeight: 600,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {algoIsPhone ? `Signals · ${mobileStatusLine}` : `Signals to Action · ${statusLine}`}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: sp(algoIsPhone ? 4 : 6),
            alignItems: "center",
            flexWrap: "nowrap",
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
              flex: "1 1 220px",
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
                maxWidth: dim(algoIsPhone ? 104 : 132),
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
        {columnsOpen && !algoIsPhone ? (
          <OperationsSignalColumnDrawer
            columnOrder={columnOrder}
            visibleColumnIds={visibleColumnIds}
            onClose={() => setColumnsOpen(false)}
            onMove={moveColumn}
            onReset={resetColumns}
            onToggle={toggleColumn}
          />
        ) : null}
      </div>

      <div style={{ minWidth: tableMinWidth }}>
        <OperationsSignalTableHeader
          algoIsPhone={algoIsPhone}
          columns={visibleColumns}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSortChange={handleSortChange}
        />

        <div style={{ maxHeight: 520, overflowY: "auto", minWidth: 0 }}>
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
            pageRows.map(({ signal, candidate, scoreBreakdown }) => {
              const symbol = asRecord(signal).symbol;
              const expanded = focus.focusedSymbol === symbol;
              return (
                <OperationsSignalRow
                  key={asRecord(signal).signalKey || symbol}
                  signal={signal}
                  candidate={candidate}
                  scoreBreakdown={scoreBreakdown}
                  tfMatrix={signalMatrixBySymbol?.[String(symbol || "").toUpperCase()] || null}
                  tickerSnapshot={
                    tickerSnapshotsBySymbol?.[String(symbol || "").toUpperCase()] || null
                  }
                  expanded={expanded && !algoIsPhone}
                  onToggle={() => {
                    if (expanded) {
                      clearAlgoFocus();
                    } else {
                      setAlgoFocus(symbol);
                    }
                  }}
                  expandedContent={
                    expanded && !algoIsPhone
                      ? renderDrill?.({ signal, candidate, drillTab: focus.drillTab })
                      : null
                  }
                  algoIsPhone={false}
                  columns={visibleColumns}
                  scanActive={freshness.scanRunning}
                  onRowAction={handleRowAction}
                />
              );
            })
          )}
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
      {algoIsPhone && focus.focusedSymbol ? (
        <BottomSheet
          open={Boolean(focus.focusedSymbol)}
          onClose={clearAlgoFocus}
          title={focus.focusedSymbol}
          testId="algo-signal-drill-sheet"
        >
          {(() => {
            const focusedRow = rows.find(
              ({ signal }) =>
                String(asRecord(signal).symbol || "").toUpperCase() ===
                String(focus.focusedSymbol || "").toUpperCase(),
            );
            return (
              focusedRow &&
              renderDrill?.({
                signal: focusedRow.signal,
                candidate: focusedRow.candidate,
                drillTab: focus.drillTab,
              })
            );
          })()}
        </BottomSheet>
      ) : null}
    </div>
  );
};

export default OperationsSignalTable;
