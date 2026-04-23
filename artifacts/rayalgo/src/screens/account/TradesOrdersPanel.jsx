import { useState } from "react";
import { T, fs, sp } from "../../RayAlgoPlatform";
import {
  EmptyState,
  Panel,
  denseButtonStyle,
  formatMoney,
  formatNumber,
  formatPercent,
  tableCellStyle,
  tableHeaderStyle,
  toneForValue,
} from "./accountUtils";

const orderColumns = [
  "Symbol",
  "Side",
  "Type",
  "Qty",
  "Limit/Stop",
  "TIF",
  "Status",
  "Placed",
  "Filled",
  "Avg Fill",
  "Commission",
  "Action",
];

export const OrdersPanel = ({
  query,
  tab,
  onTabChange,
  currency,
  onCancelOrder,
  cancelPending,
}) => (
  <Panel
    title="Orders"
    subtitle="Working orders live from bridge; history from bridge/local ledger"
    loading={query.isLoading}
    error={query.error}
    minHeight={280}
    action={
      <div style={{ display: "flex", gap: sp(4) }}>
        {["working", "history"].map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onTabChange(item)}
            style={denseButtonStyle(tab === item)}
          >
            {item === "working" ? "Working" : "History"}
          </button>
        ))}
      </div>
    }
  >
    {!query.data?.orders?.length ? (
      <EmptyState
        title={`No ${tab} orders`}
        body="Working orders update from the IBKR order stream. Historical rows appear as orders reach a terminal status."
      />
    ) : (
      <div style={{ overflow: "auto", maxHeight: 320 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1040 }}>
          <thead>
            <tr style={tableHeaderStyle}>
              {orderColumns.map((column) => (
                <th key={column} style={{ ...tableCellStyle, ...tableHeaderStyle }}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {query.data.orders.map((order) => (
              <tr key={order.id} tabIndex={0}>
                <td style={{ ...tableCellStyle, color: T.text, fontWeight: 900 }}>
                  {order.symbol}
                </td>
                <td style={tableCellStyle}>{order.side}</td>
                <td style={tableCellStyle}>{order.type}</td>
                <td style={tableCellStyle}>
                  {formatNumber(order.filledQuantity, 2)} / {formatNumber(order.quantity, 2)}
                </td>
                <td style={tableCellStyle}>
                  {order.limitPrice ? formatMoney(order.limitPrice, currency) : "----"} /{" "}
                  {order.stopPrice ? formatMoney(order.stopPrice, currency) : "----"}
                </td>
                <td style={tableCellStyle}>{order.timeInForce}</td>
                <td style={tableCellStyle}>{order.status}</td>
                <td style={tableCellStyle}>
                  {order.placedAt ? new Date(order.placedAt).toLocaleString() : "----"}
                </td>
                <td style={tableCellStyle}>
                  {order.filledAt ? new Date(order.filledAt).toLocaleString() : "----"}
                </td>
                <td style={tableCellStyle}>
                  {order.averageFillPrice
                    ? formatMoney(order.averageFillPrice, currency)
                    : "----"}
                </td>
                <td style={tableCellStyle}>
                  {order.commission ? formatMoney(order.commission, currency) : "----"}
                </td>
                <td style={tableCellStyle}>
                  {tab === "working" ? (
                    <button
                      type="button"
                      disabled={cancelPending}
                      onClick={() => onCancelOrder(order)}
                      style={denseButtonStyle(false)}
                    >
                      Cancel
                    </button>
                  ) : (
                    <span style={{ color: T.textMuted }}>{order.source}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Panel>
);

export const ClosedTradesPanel = ({ query, currency }) => {
  const [pnlFilter, setPnlFilter] = useState("all");
  const rows = (query.data?.trades || []).filter((trade) => {
    if (pnlFilter === "winners") return (trade.realizedPnl ?? 0) > 0;
    if (pnlFilter === "losers") return (trade.realizedPnl ?? 0) < 0;
    return true;
  });

  return (
    <Panel
      title="Past Positions / Closed Trades"
      subtitle="Unified live execution and Flex trade ledger"
      loading={query.isLoading}
      error={query.error}
      minHeight={320}
      action={
        <div style={{ display: "flex", gap: sp(4) }}>
          {["all", "winners", "losers"].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPnlFilter(item)}
              style={denseButtonStyle(pnlFilter === item)}
            >
              {item}
            </button>
          ))}
        </div>
      }
    >
      {!rows.length ? (
        <EmptyState
          title="No closed trades in this window"
          body="Recent IBKR executions are shown live. Older lifetime trades appear after the Flex refresh imports the Trades section."
        />
      ) : (
        <div style={{ overflow: "auto", maxHeight: 360 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
            <thead>
              <tr style={tableHeaderStyle}>
                {[
                  "Symbol",
                  "Side",
                  "Qty",
                  "Open Date",
                  "Close Date",
                  "Avg Open",
                  "Avg Close",
                  "Realized P&L",
                  "Hold",
                  "Comms",
                  "Source",
                ].map((column) => (
                  <th key={column} style={{ ...tableCellStyle, ...tableHeaderStyle }}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((trade) => (
                <tr key={`${trade.source}:${trade.id}`} tabIndex={0}>
                  <td style={{ ...tableCellStyle, color: T.text, fontWeight: 900 }}>
                    {trade.symbol}
                  </td>
                  <td style={tableCellStyle}>{trade.side}</td>
                  <td style={tableCellStyle}>{formatNumber(trade.quantity, 3)}</td>
                  <td style={tableCellStyle}>
                    {trade.openDate ? new Date(trade.openDate).toLocaleDateString() : "----"}
                  </td>
                  <td style={tableCellStyle}>
                    {trade.closeDate ? new Date(trade.closeDate).toLocaleDateString() : "----"}
                  </td>
                  <td style={tableCellStyle}>
                    {trade.avgOpen ? formatMoney(trade.avgOpen, currency) : "----"}
                  </td>
                  <td style={tableCellStyle}>
                    {trade.avgClose ? formatMoney(trade.avgClose, currency) : "----"}
                  </td>
                  <td style={{ ...tableCellStyle, color: toneForValue(trade.realizedPnl) }}>
                    {formatMoney(trade.realizedPnl, trade.currency || currency)}{" "}
                    {trade.realizedPnlPercent != null
                      ? `/ ${formatPercent(trade.realizedPnlPercent)}`
                      : ""}
                  </td>
                  <td style={tableCellStyle}>
                    {trade.holdDurationMinutes
                      ? `${Math.round(trade.holdDurationMinutes / 60)}h`
                      : "----"}
                  </td>
                  <td style={tableCellStyle}>
                    {trade.commissions ? formatMoney(trade.commissions, currency) : "----"}
                  </td>
                  <td style={tableCellStyle}>
                    <span
                      style={{
                        color: trade.source === "FLEX" ? T.accent : T.green,
                        border: `1px solid ${trade.source === "FLEX" ? T.accent : T.green}55`,
                        padding: sp("2px 5px"),
                        fontSize: fs(9),
                        fontWeight: 800,
                      }}
                    >
                      {trade.source}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
};

export default ClosedTradesPanel;
