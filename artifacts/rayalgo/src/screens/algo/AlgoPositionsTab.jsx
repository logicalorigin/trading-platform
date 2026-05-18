import {
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatRelativeTimeShort } from "../../lib/formatters";
import { motionRowStyle } from "../../lib/motion";
import {
  asRecord,
  formatContractLabel,
  formatMoney,
  formatPlainPrice,
  numberFrom,
} from "./algoHelpers";

export const AlgoPositionsTab = ({ signalOptionsPositions, algoIsPhone }) => (
  <div
    style={{
      display: "grid",
      gap: 0,
      borderTop: `1px solid ${T.border}`,
    }}
  >
    {!signalOptionsPositions.length ? (
      <div
        style={{
          border: `1px dashed ${T.border}`,
          borderRadius: dim(RADII.sm),
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: fs(10),
          lineHeight: 1.45,
          padding: sp("14px 10px"),
        }}
      >
        No open shadow option positions. Filled signal-options entries
        will appear here with marks, stops, and premium exposure.
      </div>
    ) : (
      signalOptionsPositions.map((position, index) => {
        const contract = asRecord(position.selectedContract);
        const multiplier = numberFrom(contract.multiplier, 100);
        const mark = numberFrom(position.lastMarkPrice, NaN);
        const entry = numberFrom(position.entryPrice, NaN);
        const quantity = numberFrom(position.quantity, 0);
        const unrealized =
          Number.isFinite(mark) && Number.isFinite(entry)
            ? (mark - entry) * quantity * multiplier
            : null;
        return (
          <div
            key={position.id || position.candidateId}
            className="ra-row-enter"
            style={{
              ...motionRowStyle(index, 10, 70),
              display: "grid",
              gridTemplateColumns: algoIsPhone
                ? "minmax(0, 1fr)"
                : "minmax(160px, 1fr) repeat(4, minmax(82px, 0.7fr))",
              gap: sp(8),
              alignItems: "center",
              borderBottom: `1px solid ${T.border}`,
              padding: sp("6px 0"),
              minWidth: 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  color: T.text,
                  fontFamily: T.sans,
                  fontSize: textSize("caption"),
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {position.symbol} {formatContractLabel(contract)}
              </div>
              <div
                style={{
                  color: T.textDim,
                  fontFamily: T.sans,
                  fontSize: textSize("body"),
                  marginTop: sp(2),
                }}
              >
                {position.timeframe} · opened{" "}
                {formatRelativeTimeShort(position.openedAt)}
              </div>
            </div>
            {[
              ["Qty", quantity],
              ["Entry", formatPlainPrice(entry, 2)],
              ["Mark", formatPlainPrice(mark, 2)],
              ["P&L", formatMoney(unrealized, 2)],
            ].map(([label, value]) => (
              <div key={label}>
                <div
                  style={{
                    color: T.textMuted,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    letterSpacing: "0.04em",
                  }}
                >
                  {label.toUpperCase()}
                </div>
                <div
                  style={{
                    color:
                      label === "P&L" && Number(unrealized) < 0
                        ? T.red
                        : label === "P&L" && Number(unrealized) > 0
                          ? T.green
                          : T.text,
                    fontFamily: T.sans,
                    fontSize: textSize("caption"),
                    marginTop: sp(2),
                  }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>
        );
      })
    )}
  </div>
);

export default AlgoPositionsTab;
