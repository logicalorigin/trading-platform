import React from "react";
import { STRATEGY_LOG_LABELS } from "../../../research/config/strategyPresets.js";
import { getResearchTradeSelectionId } from "../../../research/trades/selection.js";
import { B, F, FS, G, M, R, Y } from "./shared.jsx";

export default function ResearchInsightsLogTab({
  trades,
  skippedTrades = [],
  logPage,
  setLogPage,
  selectedTradeId = null,
  onSelectTrade = null,
  isRunning = false,
}) {
  const perPage = 15;
  const totalPages = Math.ceil(trades.length / perPage);
  const visibleTrades = trades.slice(logPage * perPage, (logPage + 1) * perPage);

  if (trades.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: "#9ca3af", fontFamily: F, fontSize: 16 }}>
        {isRunning
          ? "Backtest is running. Closed trades will appear here live."
          : skippedTrades.length > 0
          ? `No executed option trades. ${skippedTrades.length} signals were skipped during options-history resolution.`
          : "No trades - adjust parameters."}
      </div>
    );
  }

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F, fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
            {["#", "ID", "Entry", "Ticker", "Expiry", "Strat", "Dir", "IV", "Opt$", "Qty", "Exit$", "P&L", "Fees", "Bars", "Reason"].map(
              (header) => (
                <th
                  key={header}
                  style={{
                    padding: "2px 3px",
                    textAlign: "left",
                    color: "#9ca3af",
                    fontWeight: 500,
                    fontSize: 13,
                    textTransform: "uppercase",
                    fontFamily: FS,
                  }}
                >
                  {header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {visibleTrades.map((trade, index) => {
            const tradeId = getResearchTradeSelectionId(trade);
            const isSelected = selectedTradeId === tradeId;
            return (
            <tr
              key={tradeId || (logPage * perPage + index)}
              onClick={typeof onSelectTrade === "function" ? () => onSelectTrade(tradeId) : undefined}
              style={{
                borderBottom: "1px solid #f3f4f6",
                background: isSelected ? `${B}08` : "transparent",
                cursor: typeof onSelectTrade === "function" ? "pointer" : "default",
              }}
            >
              <td style={{ padding: "2px 3px", color: "#9ca3af" }}>{logPage * perPage + index + 1}</td>
              <td
                title={tradeId || ""}
                style={{
                  padding: "2px 3px",
                  color: "#475569",
                  fontSize: 11,
                  fontFamily: F,
                  maxWidth: 176,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {tradeId || "-"}
              </td>
              <td style={{ padding: "2px 3px", color: M, fontSize: 12 }}>{trade.ts}</td>
              <td style={{ padding: "2px 3px", color: "#0f766e", fontSize: 11 }}>{trade.optionTicker || "-"}</td>
              <td style={{ padding: "2px 3px", color: "#8b5cf6", fontSize: 12 }}>{trade.expiryDate || "-"}</td>
              <td style={{ padding: "2px 3px", color: B, fontSize: 11 }}>{STRATEGY_LOG_LABELS[trade.strat] || "-"}</td>
              <td style={{ padding: "2px 3px", color: trade.dir === "long" ? G : R, fontWeight: 600 }}>
                {trade.dir === "long" ? "LONG" : "SHORT"}
              </td>
              <td style={{ padding: "2px 3px", color: M, fontSize: 12 }}>{trade.entryIV || "-"}%</td>
              <td style={{ padding: "2px 3px", color: M }}>${trade.oe.toFixed(2)}</td>
              <td style={{ padding: "2px 3px", color: M }}>{trade.qty}</td>
              <td style={{ padding: "2px 3px", color: M }}>${(trade.ep || 0).toFixed(2)}</td>
              <td style={{ padding: "2px 3px", color: trade.pnl >= 0 ? G : R, fontWeight: 600 }}>
                {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(0)}
              </td>
              <td style={{ padding: "2px 3px", color: "#f97316", fontSize: 12 }}>
                ${(trade.fees || 0).toFixed(0)}
              </td>
              <td style={{ padding: "2px 3px", color: M }}>{trade.bh}</td>
              <td
                style={{
                  padding: "2px 3px",
                  color:
                    trade.er === "take_profit"
                      ? G
                      : trade.er === "stop_loss"
                        ? R
                        : trade.er === "trailing_stop"
                          ? B
                          : trade.er === "expired"
                            ? "#8b5cf6"
                            : Y,
                  fontSize: 12,
                }}
              >
                {(trade.er || "").replace(/_/g, " ")}
              </td>
            </tr>
          );
          })}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 3 }}>
          <button
            disabled={logPage === 0}
            onClick={() => setLogPage((page) => page - 1)}
            style={{
              background: "#f3f4f6",
              border: "1px solid #e5e7eb",
              borderRadius: 3,
              padding: "1px 7px",
              color: logPage === 0 ? "#d1d5db" : "#4b5563",
              cursor: logPage === 0 ? "default" : "pointer",
              fontFamily: F,
              fontSize: 14,
            }}
          >
            Prev
          </button>
          <span style={{ color: "#9ca3af", fontFamily: F, fontSize: 14 }}>
            {logPage + 1}/{totalPages}
          </span>
          <button
            disabled={logPage >= totalPages - 1}
            onClick={() => setLogPage((page) => page + 1)}
            style={{
              background: "#f3f4f6",
              border: "1px solid #e5e7eb",
              borderRadius: 3,
              padding: "1px 7px",
              color: logPage >= totalPages - 1 ? "#d1d5db" : "#4b5563",
              cursor: logPage >= totalPages - 1 ? "default" : "pointer",
              fontFamily: F,
              fontSize: 14,
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
