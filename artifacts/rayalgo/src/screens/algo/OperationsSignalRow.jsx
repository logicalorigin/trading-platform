import {
  FONT_WEIGHTS,
  MISSING_VALUE,
  T,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { TableExpandableRow } from "../../components/platform/primitives.jsx";
import {
  asRecord,
  formatContractLabel,
  formatMoney,
  signalActionLabel,
  signalOptionsActionColor,
  signalOptionsActionLabel,
} from "./algoHelpers";

const COLUMNS = [
  { key: "symbol", label: "Sym", width: 52 },
  { key: "dir", label: "Dir", width: 32 },
  { key: "score", label: "Score", width: 48 },
  { key: "bars", label: "Bars", width: 36 },
  { key: "action", label: "Mapped action", width: null },
  { key: "spread", label: "Spr", width: 44 },
  { key: "liq", label: "Liq", width: 28 },
  { key: "status", label: "Status", width: 96 },
];

const directionGlyph = (direction) => {
  if (direction === "buy" || direction === "long") return "↑+";
  if (direction === "sell" || direction === "short") return "↓-";
  return "—";
};

const formatScore = (value) => {
  if (value == null) return MISSING_VALUE;
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(1) : MISSING_VALUE;
};

const formatBars = (value) => {
  if (value == null) return MISSING_VALUE;
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num)) : MISSING_VALUE;
};

const spreadDisplay = (candidate) => {
  const cents = asRecord(candidate?.liquidity).spreadCents;
  if (Number.isFinite(Number(cents))) return `${Number(cents).toFixed(0)}¢`;
  const pct = asRecord(candidate?.liquidity).spreadPctOfMid;
  if (Number.isFinite(Number(pct))) return `${Number(pct).toFixed(0)}%`;
  return MISSING_VALUE;
};

const liquidityGlyph = (candidate) => {
  if (!candidate) return "—";
  const reason = String(candidate.reason || "");
  if (reason === "missing_bid_ask" || reason === "spread_too_wide" || reason === "bid_below_minimum") {
    return "⚠";
  }
  if (asRecord(candidate.liquidity).bid != null) return "✓";
  return "—";
};

const statusLabel = (signal, candidate) => {
  if (candidate?.actionStatus || candidate?.status) {
    return signalOptionsActionLabel(candidate.actionStatus || candidate.status);
  }
  if (signal?.status === "unavailable") return "Unavailable";
  return signal?.fresh === false ? "Stale" : "Awaiting scan";
};

const actionDisplay = (signal, candidate) => {
  if (!candidate) {
    return signalActionLabel(signal, null);
  }
  const contract = formatContractLabel(candidate.selectedContract);
  const limit = formatMoney(asRecord(candidate.orderPlan).entryLimitPrice, 2);
  if (contract === MISSING_VALUE) return signalActionLabel(signal, candidate.action);
  return `${contract} ${limit}`;
};

export const OperationsSignalTableHeader = ({ algoIsPhone }) => (
  <div
    style={{
      display: algoIsPhone ? "none" : "grid",
      gridTemplateColumns: COLUMNS.map((column) =>
        column.width ? `${column.width}px` : "minmax(0, 1fr)",
      ).join(" "),
      gap: sp(3),
      alignItems: "center",
      padding: sp("3px 6px"),
      borderBottom: `1px solid ${T.border}`,
      background: T.bg1,
      color: T.textMuted,
      fontFamily: T.sans,
      fontSize: textSize("caption"),
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      position: "sticky",
      top: 0,
      zIndex: 1,
    }}
  >
    {COLUMNS.map((column) => (
      <span key={column.key}>{column.label}</span>
    ))}
  </div>
);

export const OperationsSignalRow = ({
  signal,
  candidate,
  expanded,
  onToggle,
  expandedContent,
  algoIsPhone,
}) => {
  const signalRecord = asRecord(signal);
  const tone =
    signalRecord.fresh === false
      ? T.amber
      : candidate
        ? signalOptionsActionColor(
            candidate.actionStatus || candidate.status,
          )
        : T.textDim;
  return (
    <TableExpandableRow
      expanded={expanded}
      onToggle={onToggle}
      rowHeight={22}
      expandedHeight={220}
      selectionAccent={tone}
      borderTone={T.border}
      dataTestId={`algo-signal-row-${signalRecord.symbol}`}
      row={
        <div
          style={{
            display: "grid",
            gridTemplateColumns: algoIsPhone
              ? "minmax(0, 1fr) auto"
              : COLUMNS.map((column) =>
                  column.width ? `${column.width}px` : "minmax(0, 1fr)",
                ).join(" "),
            gap: sp(3),
            alignItems: "center",
            paddingLeft: sp(6),
            paddingRight: sp(6),
            width: "100%",
            fontFamily: T.mono,
            fontSize: fs(11),
            color: T.text,
          }}
        >
          {algoIsPhone ? (
            <>
              <span
                style={{
                  fontWeight: FONT_WEIGHTS.medium,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {signalRecord.symbol || MISSING_VALUE}{" "}
                <span style={{ color: tone }}>{directionGlyph(signalRecord.direction)}</span>
              </span>
              <span style={{ color: tone, fontSize: textSize("caption") }}>
                {statusLabel(signalRecord, candidate)}
              </span>
            </>
          ) : (
            <>
              <span style={{ fontWeight: FONT_WEIGHTS.medium }}>
                {signalRecord.symbol || MISSING_VALUE}
              </span>
              <span style={{ color: tone }}>
                {directionGlyph(signalRecord.direction)}
              </span>
              <span>{formatScore(signalRecord.score)}</span>
              <span style={{ color: T.textSec }}>
                {formatBars(signalRecord.barsSinceSignal)}
              </span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: T.textSec,
                }}
              >
                {actionDisplay(signalRecord, candidate)}
              </span>
              <span style={{ color: T.textSec }}>{spreadDisplay(candidate)}</span>
              <span
                style={{
                  color:
                    liquidityGlyph(candidate) === "⚠"
                      ? T.amber
                      : liquidityGlyph(candidate) === "✓"
                        ? T.green
                        : T.textDim,
                  textAlign: "center",
                }}
              >
                {liquidityGlyph(candidate)}
              </span>
              <span
                style={{
                  color: tone,
                  fontSize: textSize("caption"),
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {statusLabel(signalRecord, candidate)}
              </span>
            </>
          )}
        </div>
      }
      expandedContent={expandedContent}
    />
  );
};

export default OperationsSignalRow;
