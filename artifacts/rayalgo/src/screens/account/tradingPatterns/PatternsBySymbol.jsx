import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import {
  Pill,
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "../accountUtils";
import { arrayValue } from "./patternsCommon";

const TickerRows = ({ rows, currency, maskValues, onSymbolSelect, selectedSymbol }) => (
  <div className="ra-hide-scrollbar" style={{ overflow: "auto", maxHeight: dim(220) }}>
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: dim(720) }}>
      <thead>
        <tr
          style={{
            color: T.textMuted,
            fontFamily: T.data,
            fontSize: textSize("tableHeader"),
            textTransform: "uppercase",
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          {["Symbol", "P&L", "Win", "Exp", "PF", "Trades", "Hold", "Open"].map((column) => (
            <th key={column} style={{ padding: sp("4px 5px"), textAlign: "left" }}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.symbol}
            className="ra-table-row"
            style={{
              background:
                selectedSymbol && row.symbol === selectedSymbol
                  ? `${T.cyan}14`
                  : "transparent",
            }}
          >
            <td style={{ padding: sp("5px"), color: T.text, fontFamily: T.data, fontWeight: FONT_WEIGHTS.regular }}>
              <button
                type="button"
                onClick={() => onSymbolSelect?.(row.symbol)}
                className="ra-interactive"
                style={{
                  border: "none",
                  background: "transparent",
                  color: T.cyan,
                  fontFamily: T.data,
                  fontWeight: FONT_WEIGHTS.regular,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {row.symbol}
              </button>
            </td>
            <td style={{ padding: sp("5px"), color: toneForValue(row.realizedPnl), fontFamily: T.data }}>
              {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {formatAccountPercent(row.winRatePercent, 0, maskValues)}
            </td>
            <td style={{ padding: sp("5px"), color: toneForValue(row.expectancy), fontFamily: T.data }}>
              {formatAccountMoney(row.expectancy, currency, true, maskValues)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {row.profitFactor == null ? "—" : formatNumber(row.profitFactor, 2)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {formatNumber(row.closedTrades || 0, 0)}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {row.averageHoldMinutes == null
                ? "—"
                : `${formatNumber(row.averageHoldMinutes / 60, 1)}h`}
            </td>
            <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
              {formatNumber(row.openQuantity || 0, 2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const SourceBreakdown = ({ sourceRows, currency, maskValues }) => {
  if (!sourceRows?.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(3) }}>
      <div style={mutedLabelStyle}>SOURCE BREAKDOWN</div>
      {sourceRows.map((row) => (
        <div
          key={row.key || row.label}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: sp(4),
            border: "none",
            borderRadius: dim(RADII.md),
            background: T.bg1,
            padding: sp("5px 7px"),
            color: T.textSec,
            fontFamily: T.data,
            fontSize: textSize("tableCell"),
            textAlign: "left",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.label || row.sourceType}
          </span>
          <span style={{ color: toneForValue(row.realizedPnl), fontWeight: FONT_WEIGHTS.regular }}>
            {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
          </span>
        </div>
      ))}
    </div>
  );
};

export const PatternsBySymbol = ({
  tickerRows,
  sourceRows,
  symbolsTraded,
  tickerOrder,
  currency,
  maskValues,
  selectedSymbol,
  onSymbolSelect,
}) => (
  <div style={{ display: "grid", gap: sp(5) }}>
    <div style={{ display: "grid", gap: sp(4), minWidth: 0 }}>
      <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap", alignItems: "center" }}>
        <Pill tone={tickerOrder === "bottom" ? "pnl-negative" : "pnl-positive"}>
          {tickerOrder === "bottom" ? "Bottom Tickers" : "Top Tickers"}
        </Pill>
        <Pill tone="purple">{formatNumber(symbolsTraded || 0, 0)} symbols</Pill>
      </div>
      <TickerRows
        rows={arrayValue(tickerRows).slice(0, 8)}
        currency={currency}
        maskValues={maskValues}
        onSymbolSelect={onSymbolSelect}
        selectedSymbol={selectedSymbol}
      />
    </div>
    <SourceBreakdown sourceRows={arrayValue(sourceRows).slice(0, 5)} currency={currency} maskValues={maskValues} />
  </div>
);

export default PatternsBySymbol;
