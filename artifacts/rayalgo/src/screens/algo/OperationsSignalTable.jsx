import { useMemo, useState } from "react";
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
import { asRecord } from "./algoHelpers";
import {
  OperationsSignalRow,
  OperationsSignalTableHeader,
} from "./OperationsSignalRow";

const FILTER_OPTIONS = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "blocked", label: "Blocked" },
  { id: "unavailable", label: "Unavailable" },
];

const SORT_OPTIONS = [
  { id: "score", label: "Score" },
  { id: "symbol", label: "Symbol" },
  { id: "bars", label: "Bars" },
];

const candidateByKey = (candidates, signalKey) =>
  candidates.find(
    (candidate) =>
      asRecord(candidate?.signal).signalKey &&
      asRecord(candidate?.signal).signalKey === signalKey,
  ) || null;

const classifySignal = (signal, candidate) => {
  if (signal?.status === "unavailable") return "unavailable";
  if (candidate?.actionStatus === "blocked" || candidate?.status === "blocked") {
    return "blocked";
  }
  if (candidate?.reason) return "blocked";
  return "ready";
};

const sortRows = (rows, sortKey) => {
  const copy = [...rows];
  if (sortKey === "symbol") {
    copy.sort((a, b) =>
      String(a.signal.symbol || "").localeCompare(
        String(b.signal.symbol || ""),
      ),
    );
  } else if (sortKey === "bars") {
    copy.sort((a, b) => {
      const aBars = Number(a.signal.barsSinceSignal ?? Number.POSITIVE_INFINITY);
      const bBars = Number(b.signal.barsSinceSignal ?? Number.POSITIVE_INFINITY);
      return aBars - bBars;
    });
  } else {
    copy.sort((a, b) => {
      const aScore = Number(a.signal.score ?? Number.NEGATIVE_INFINITY);
      const bScore = Number(b.signal.score ?? Number.NEGATIVE_INFINITY);
      return bScore - aScore;
    });
  }
  return copy;
};

export const OperationsSignalTable = ({
  signals = [],
  candidates = [],
  algoIsPhone,
  renderDrill,
}) => {
  const [filter, setFilter] = useState("all");
  const [sortKey, setSortKey] = useState("score");
  const focus = useAlgoFocus();
  const rows = useMemo(() => {
    const augmented = (signals || []).map((signal) => {
      const signalKey = asRecord(signal).signalKey;
      const candidate = candidateByKey(candidates || [], signalKey);
      return { signal, candidate, classification: classifySignal(signal, candidate) };
    });
    const filtered =
      filter === "all"
        ? augmented
        : augmented.filter((row) => row.classification === filter);
    return sortRows(filtered, sortKey);
  }, [candidates, filter, signals, sortKey]);

  const counts = useMemo(() => {
    const augmented = (signals || []).map((signal) => {
      const signalKey = asRecord(signal).signalKey;
      const candidate = candidateByKey(candidates || [], signalKey);
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
        overflow: "hidden",
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
            fontSize: fs(12),
            fontWeight: 600,
          }}
        >
          Signals → Action
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
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              style={{
                padding: sp("2px 8px"),
                borderRadius: dim(RADII.pill),
                border: `1px solid ${filter === option.id ? T.accent : T.border}`,
                background: filter === option.id ? `${T.accent}1c` : "transparent",
                color: filter === option.id ? T.text : T.textDim,
                fontFamily: T.sans,
                fontSize: textSize("caption"),
                cursor: "pointer",
              }}
            >
              {option.label}{" "}
              <span style={{ color: T.textMuted }}>{counts[option.id] ?? 0}</span>
            </button>
          ))}
          <span style={{ paddingLeft: sp(4) }}>
            Sort{" "}
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
          <div
            style={{
              padding: sp("16px 14px"),
              color: T.textDim,
              fontFamily: T.sans,
              fontSize: textSize("caption"),
            }}
          >
            No signals match the current filter.
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
