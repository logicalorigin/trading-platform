import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  Inbox,
  List,
  MinusCircle,
  Search,
} from "lucide-react";
import {
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
import {
  asRecord,
  findSignalOptionsCandidateForSignal,
  optionProviderContractId,
  resolveSignalScoreBreakdown,
} from "./algoHelpers";
import {
  OperationsSignalRow,
  OperationsSignalTableHeader,
} from "./OperationsSignalRow";

const FILTER_OPTIONS = [
  { id: "all", label: "All", icon: List, tone: T.accent },
  { id: "ready", label: "Ready", icon: CheckCircle2, tone: T.green },
  { id: "blocked", label: "Blocked", icon: Ban, tone: T.red },
  { id: "unavailable", label: "Unavailable", icon: MinusCircle, tone: T.textDim },
];

const SIGNALS_PAGE_SIZE = 30;

const SORT_LABELS = {
  newest: "Newest",
  symbol: "Symbol",
  bars: "Bars",
  score: "Score",
};

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

const sortRows = (rows, sortKey, focusedSymbol = null) => {
  const focused = String(focusedSymbol || "").toUpperCase();
  const copy = [...rows];
  const isFocused = (row) =>
    focused &&
    String(row.signal.symbol || "").toUpperCase() === focused;
  const baseCompare = (a, b) => {
    if (sortKey === "symbol") {
      return String(a.signal.symbol || "").localeCompare(
        String(b.signal.symbol || ""),
      );
    }
    if (sortKey === "bars") {
      const aBars = Number(a.signal.barsSinceSignal ?? Number.POSITIVE_INFINITY);
      const bBars = Number(b.signal.barsSinceSignal ?? Number.POSITIVE_INFINITY);
      return aBars - bBars;
    }
    if (sortKey === "score") {
      return (
        scoreSortValue(b.scoreBreakdown) - scoreSortValue(a.scoreBreakdown) ||
        signalTimestampMs(b.signal) - signalTimestampMs(a.signal)
      );
    }
    return (
      signalTimestampMs(b.signal) - signalTimestampMs(a.signal) ||
      rowActivityTimestampMs(b) - rowActivityTimestampMs(a) ||
      String(a.signal.symbol || "").localeCompare(String(b.signal.symbol || ""))
    );
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
  const [sortKey, setSortKey] = useState("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const focus = useAlgoFocus();
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
    return sortRows(filtered, sortKey, focus.focusedSymbol);
  }, [candidates, filter, focus.focusedSymbol, searchQuery, signals, sortKey]);
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
  }, [filter, focus.focusedSymbol, searchQuery, sortKey]);
  useEffect(() => {
    if (paginatedRows.safePage !== page) {
      setPage(paginatedRows.safePage);
    }
  }, [page, paginatedRows.safePage]);

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
    };
  }, [cockpitGeneratedAt, cockpitStageItems, signals]);

  const freshnessItems = [
    freshness.latestSignalAt
      ? `Signal ${formatRelativeTimeShort(freshness.latestSignalAt)}`
      : "Signal --",
    freshness.scanRunning
      ? "Scan running"
      : freshness.latestScanAt
        ? `Scan ${formatRelativeTimeShort(freshness.latestScanAt)}`
        : "Scan --",
  ];
  const activeFilter = FILTER_OPTIONS.find((option) => option.id === filter) || FILTER_OPTIONS[0];
  const compactTools = algoIsPhone || algoIsNarrow;
  const statusLine = `${activeFilter.label} ${rows.length} of ${counts.all} signals · ${freshnessItems.join(" · ")}`;
  const sortSummary = `Sorted by ${SORT_LABELS[sortKey] || "Newest"} · ${rows.length} rows`;
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
      style={{
        background: T.bg1,
        border: `1px solid ${T.border}`,
        borderRadius: dim(RADII.md),
        overflowX: "hidden",
        overflowY: "hidden",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "grid",
          gap: sp(6),
          padding: sp("6px 10px"),
          borderBottom: `1px solid ${T.border}`,
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
              color: T.text,
              fontFamily: T.sans,
              fontSize: fs(algoIsPhone ? 11 : 12),
              fontWeight: 600,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {algoIsPhone ? "Signals" : "Signals to Action"} · {statusLine}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: sp(6),
            alignItems: "center",
            flexWrap: "nowrap",
            color: T.textDim,
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
              height: dim(26),
              padding: sp("0 8px"),
              borderRadius: dim(RADII.sm),
              border: `1px solid ${T.border}`,
              background: T.bg2,
              color: T.textMuted,
            }}
          >
            <Search size={13} strokeWidth={1.8} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Symbol or strategy"
              aria-label="Search signals by symbol or strategy"
              style={{
                width: "100%",
                minWidth: 0,
                border: 0,
                outline: 0,
                background: "transparent",
                color: T.text,
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
                height: dim(26),
                maxWidth: dim(132),
                borderRadius: dim(RADII.sm),
                border: `1px solid ${T.border}`,
                background: T.bg2,
                color: T.text,
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
                    border: `1px solid ${active ? option.tone : T.border}`,
                    background: active ? `${option.tone}1c` : "transparent",
                    color: active ? T.text : T.textDim,
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
                      style={{ color: active ? option.tone : T.textMuted }}
                    />
                  ) : null}
                  <span>{option.label}</span>
                  <span style={{ color: active ? option.tone : T.textMuted }}>
                    {counts[option.id] ?? 0}
                  </span>
                </button>
              );
            })
          )}
          {!algoIsPhone ? (
            <span
              style={{
                flex: "0 0 auto",
                color: T.textMuted,
                whiteSpace: "nowrap",
              }}
            >
              {sortSummary}
            </span>
          ) : null}
        </div>
      </div>

      <OperationsSignalTableHeader
        algoIsPhone={algoIsPhone}
        sortKey={sortKey}
        onSortChange={setSortKey}
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
                algoIsPhone={algoIsPhone}
                onRowAction={handleRowAction}
              />
            );
          })
        )}
      </div>
      <PaginationFooter
        dataTestId="algo-signals-pagination"
        label="Rows"
        onPageChange={setPage}
        page={paginatedRows.safePage}
        pageCount={paginatedRows.pageCount}
        pageSize={SIGNALS_PAGE_SIZE}
        total={paginatedRows.total}
        style={{ padding: sp("6px 10px"), borderTop: `1px solid ${T.border}` }}
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
