import {
  FONT_WEIGHTS,
  MISSING_VALUE,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import {
  algoFocusStore,
  setAlgoFocus,
  useAlgoFocus,
} from "../../features/platform/algoFocusStore";
import { formatRelativeTimeShort } from "../../lib/formatters";
import {
  asRecord,
  formatContractLabel,
  formatMoney,
  formatPlainPrice,
  numberFrom,
} from "./algoHelpers";

const COLUMNS = [
  { key: "symbol", label: "Sym", width: 56 },
  { key: "contract", label: "Contract", width: null },
  { key: "qty", label: "Qty", width: 40 },
  { key: "entry", label: "Entry", width: 60 },
  { key: "mark", label: "Mark", width: 60 },
  { key: "deltaPct", label: "Δ%", width: 56 },
  { key: "pnl", label: "P&L", width: 80 },
  { key: "opened", label: "Opened", width: 80 },
  { key: "exit", label: "Exit watch", width: 130 },
  { key: "score", label: "Score", width: 56 },
];

const formatDeltaPct = (entry, mark) => {
  if (!Number.isFinite(entry) || !Number.isFinite(mark) || entry === 0) {
    return MISSING_VALUE;
  }
  const pct = ((mark - entry) / Math.abs(entry)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
};

const exitWatchLabel = (position, hardStopPct) => {
  if (!position) return MISSING_VALUE;
  const entry = numberFrom(position.entryPrice, NaN);
  const currentStop = numberFrom(position.stopPrice, NaN);
  const peak = numberFrom(position.peakPrice, NaN);
  if (!Number.isFinite(entry)) return "none";
  if (Number.isFinite(peak) && peak > entry) {
    return `runner ${Number.isFinite(currentStop) ? `stop @ ${currentStop.toFixed(2)}` : "trailing"}`;
  }
  if (Number.isFinite(currentStop)) {
    return `hard stop @ ${currentStop.toFixed(2)}`;
  }
  if (Number.isFinite(hardStopPct)) {
    return `${hardStopPct}% stop active`;
  }
  return "none";
};

export const OperationsPositionsTable = ({
  positions = [],
  symbolIndex = {},
  signalOptionsProfile,
  algoIsPhone,
}) => {
  const focus = useAlgoFocus();
  const hardStopPct = Number(signalOptionsProfile?.exitPolicy?.hardStopPct);
  return (
    <div
      data-testid="algo-operations-positions-table"
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
          padding: sp("6px 10px"),
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <span
          style={{
            color: T.text,
            fontFamily: T.sans,
            fontSize: fs(12),
            fontWeight: FONT_WEIGHTS.medium,
          }}
        >
          Open positions
        </span>
        <span
          style={{
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
          }}
        >
          {positions.length} open
        </span>
      </div>
      <div
        style={{
          display: algoIsPhone ? "none" : "grid",
          gridTemplateColumns: COLUMNS.map((column) =>
            column.width ? `${column.width}px` : "minmax(0, 1fr)",
          ).join(" "),
          gap: sp(4),
          padding: sp("4px 10px"),
          borderBottom: `1px solid ${T.border}`,
          color: T.textMuted,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {COLUMNS.map((column) => (
          <span key={column.key}>{column.label}</span>
        ))}
      </div>
      {positions.length === 0 ? (
        <div
          style={{
            padding: sp("14px 12px"),
            color: T.textDim,
            fontFamily: T.sans,
            fontSize: textSize("caption"),
          }}
        >
          No open shadow option positions.
        </div>
      ) : (
        <div style={{ maxHeight: 280, overflowY: "auto", minWidth: 0 }}>
          {positions.map((position) => {
            const symbol = String(position.symbol || "").toUpperCase();
            const entry = numberFrom(position.entryPrice, NaN);
            const mark = numberFrom(position.lastMarkPrice, NaN);
            const qty = numberFrom(position.quantity, 0);
            const multiplier = numberFrom(asRecord(position.selectedContract).multiplier, 100);
            const unrealized =
              Number.isFinite(mark) && Number.isFinite(entry)
                ? (mark - entry) * qty * multiplier
                : null;
            const score = symbolIndex[symbol]?.signal?.score;
            const focused = focus.focusedSymbol === symbol;
            return (
              <div
                key={position.id || position.candidateId}
                role="button"
                tabIndex={0}
                onClick={() => setAlgoFocus(symbol, "position")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setAlgoFocus(symbol, "position");
                  }
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: algoIsPhone
                    ? "minmax(0, 1fr) auto"
                    : COLUMNS.map((column) =>
                        column.width ? `${column.width}px` : "minmax(0, 1fr)",
                      ).join(" "),
                  gap: sp(4),
                  alignItems: "center",
                  padding: sp("5px 10px"),
                  borderBottom: `1px solid ${T.border}`,
                  background: focused ? `${T.accent}10` : "transparent",
                  borderLeft: focused
                    ? `3px solid ${T.accent}`
                    : "3px solid transparent",
                  color: T.text,
                  fontFamily: T.mono,
                  fontSize: fs(11),
                  cursor: "pointer",
                  minWidth: 0,
                }}
              >
                {algoIsPhone ? (
                  <>
                    <span style={{ fontWeight: FONT_WEIGHTS.medium }}>
                      {symbol} {formatContractLabel(position.selectedContract)}
                    </span>
                    <span
                      style={{
                        color: Number(unrealized) >= 0 ? T.green : T.red,
                        fontSize: textSize("caption"),
                      }}
                    >
                      {formatMoney(unrealized, 2)}
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ fontWeight: FONT_WEIGHTS.medium }}>{symbol}</span>
                    <span
                      style={{
                        color: T.textSec,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatContractLabel(position.selectedContract)}
                    </span>
                    <span>{qty}</span>
                    <span>{formatPlainPrice(entry, 2)}</span>
                    <span>{formatPlainPrice(mark, 2)}</span>
                    <span
                      style={{
                        color:
                          Number.isFinite(mark) && Number.isFinite(entry) && mark >= entry
                            ? T.green
                            : T.red,
                      }}
                    >
                      {formatDeltaPct(entry, mark)}
                    </span>
                    <span
                      style={{
                        color:
                          Number(unrealized) > 0
                            ? T.green
                            : Number(unrealized) < 0
                              ? T.red
                              : T.text,
                      }}
                    >
                      {formatMoney(unrealized, 2)}
                    </span>
                    <span style={{ color: T.textDim }}>
                      {formatRelativeTimeShort(position.openedAt)}
                    </span>
                    <span
                      style={{
                        color: T.textSec,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {exitWatchLabel(position, hardStopPct)}
                    </span>
                    <span style={{ color: T.textSec }}>
                      {Number.isFinite(Number(score))
                        ? Number(score).toFixed(1)
                        : MISSING_VALUE}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OperationsPositionsTable;
