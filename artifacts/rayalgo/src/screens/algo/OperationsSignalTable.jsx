import { useMemo, useState } from "react";
import {
  ArrowUpDown,
  Ban,
  CheckCircle2,
  Inbox,
  List,
  MinusCircle,
} from "lucide-react";
import {
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  algoFocusStore,
  clearAlgoFocus,
  setAlgoFocus,
  useAlgoFocus,
} from "../../features/platform/algoFocusStore";
import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import { DataUnavailableState } from "../../components/platform/primitives.jsx";
import { useStoredOptionQuoteSnapshotVersion } from "../../features/platform/live-streams";
import { useRuntimeTickerSnapshots } from "../../features/platform/runtimeTickerStore";
import { buildSignalMatrixBySymbol } from "../../features/platform/watchlistModel";
import {
  asRecord,
  findSignalOptionsCandidateForSignal,
  optionProviderContractId,
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

const SORT_OPTIONS = [
  { id: "score", label: "Score" },
  { id: "symbol", label: "Symbol" },
  { id: "bars", label: "Bars" },
];

const classifySignal = (signal, candidate) => {
  if (signal?.status === "unavailable") return "unavailable";
  if (candidate?.actionStatus === "blocked" || candidate?.status === "blocked") {
    return "blocked";
  }
  if (candidate?.reason) return "blocked";
  return "ready";
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
    const aScore = Number(a.signal.score ?? Number.NEGATIVE_INFINITY);
    const bScore = Number(b.signal.score ?? Number.NEGATIVE_INFINITY);
    return bScore - aScore;
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
  algoIsPhone,
  renderDrill,
}) => {
  const [filter, setFilter] = useState("all");
  const [sortKey, setSortKey] = useState("score");
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
      return { signal, candidate, classification: classifySignal(signal, candidate) };
    });
    const filtered =
      filter === "all"
        ? augmented
        : augmented.filter((row) => row.classification === filter);
    return sortRows(filtered, sortKey, focus.focusedSymbol);
  }, [candidates, filter, focus.focusedSymbol, signals, sortKey]);
  const rowSymbols = useMemo(
    () =>
      rows
        .map(({ signal }) => String(asRecord(signal).symbol || "").toUpperCase())
        .filter(Boolean),
    [rows],
  );
  const tickerSnapshotsBySymbol = useRuntimeTickerSnapshots(rowSymbols);

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

  return (
    <div
      data-testid="algo-operations-signal-table"
      style={{
        background: T.bg1,
        border: `1px solid ${T.border}`,
        borderRadius: dim(RADII.md),
        overflowX: "auto",
        overflowY: "hidden",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: sp(8),
          padding: sp("6px 10px"),
          borderBottom: `1px solid ${T.border}`,
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(algoIsPhone ? 11 : 12),
            fontWeight: 600,
            flex: "0 0 auto",
            whiteSpace: "nowrap",
          }}
        >
          {algoIsPhone ? "Signals" : "Signals to Action"}
        </span>
        <div
          style={{
            display: "flex",
            gap: sp(8),
            alignItems: "center",
            flexWrap: "wrap",
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
          }}
        >
          {FILTER_OPTIONS.map((option) => {
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
                {!algoIsPhone && Icon ? (
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
          })}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: sp(3),
              paddingLeft: sp(4),
            }}
          >
            {!algoIsPhone ? (
              <ArrowUpDown
                size={12}
                strokeWidth={1.8}
                aria-hidden="true"
                style={{ color: T.textMuted }}
              />
            ) : null}
            <span>Sort</span>
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value)}
              style={{
                background: T.bg1,
                color: T.text,
                border: `1px solid ${T.border}`,
                borderRadius: dim(RADII.xs),
                padding: sp("1px 4px"),
                fontFamily: T.sans,
                fontSize: textSize("caption"),
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>
        </div>
      </div>

      <OperationsSignalTableHeader algoIsPhone={algoIsPhone} />

      <div style={{ maxHeight: 520, overflowY: "auto", minWidth: 0 }}>
        {rows.length === 0 ? (
          <div style={{ padding: sp(6) }}>
            <DataUnavailableState
              title={
                filter === "all"
                  ? "Awaiting next scan"
                  : "No signals match this filter"
              }
              detail={
                filter === "all"
                  ? "Signals appear as soon as the monitor finishes its next pass."
                  : "Switch filter to All to see signals in other states."
              }
              icon={<Inbox size={20} strokeWidth={1.8} aria-hidden="true" />}
              minHeight={56}
              loading={filter === "all"}
            />
          </div>
        ) : (
          rows.map(({ signal, candidate }) => {
            const symbol = asRecord(signal).symbol;
            const expanded = focus.focusedSymbol === symbol;
            return (
              <OperationsSignalRow
                key={asRecord(signal).signalKey || symbol}
                signal={signal}
                candidate={candidate}
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
              />
            );
          })
        )}
      </div>
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
