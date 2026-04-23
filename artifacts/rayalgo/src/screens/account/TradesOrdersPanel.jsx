import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
  controlInputStyle,
  controlSelectStyle,
  formatMoney,
  formatNumber,
  formatPercent,
  moveTableFocus,
  mutedLabelStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderStyle,
  toneForValue,
} from "./accountUtils";

const SummaryCard = ({ label, value, tone = T.text }) => (
  <div
    style={{
      padding: sp("4px 0"),
      display: "grid",
      gap: sp(3),
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div style={{ color: tone, fontSize: fs(12), fontFamily: T.mono, fontWeight: 900 }}>
      {value}
    </div>
  </div>
);

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
    rightRail={`Showing ${tab}`}
    loading={query.isLoading}
    error={query.error}
    onRetry={query.refetch}
    minHeight={320}
    noPad
    action={
      <ToggleGroup
        options={[
          { value: "working", label: "Working" },
          { value: "history", label: "History" },
        ]}
        value={tab}
        onChange={onTabChange}
      />
    }
  >
    {!query.data?.orders?.length ? (
      <div style={{ padding: sp(12) }}>
        <EmptyState
          title={`No ${tab} orders`}
          body="Working orders update from the IBKR order stream. Historical rows appear as orders reach a terminal status."
        />
      </div>
    ) : (
      <div style={{ overflow: "auto", maxHeight: 390 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1040 }}>
          <thead>
            <tr style={tableHeaderStyle}>
              {(tab === "working"
                ? ["Symbol", "Side", "Type", "Qty", "Limit / Stop", "TIF", "Status", "Placed", "Avg Fill", "Action"]
                : ["Symbol", "Side", "Type", "Qty", "Placed", "Filled", "Avg Fill", "Commission", "Status", "Source"]).map((column) => (
                <th key={column} style={{ ...tableCellStyle, ...tableHeaderStyle }}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {query.data.orders.map((order) => (
              <tr key={order.id} tabIndex={0} onKeyDown={moveTableFocus}>
                <td style={{ ...tableCellStyle, color: T.text, fontWeight: 900 }}>{order.symbol}</td>
                <td style={tableCellStyle}>
                  <Pill tone={/buy|long/i.test(order.side) ? "green" : "red"}>{order.side}</Pill>
                </td>
                <td style={tableCellStyle}>{order.type}</td>
                <td style={tableCellStyle}>
                  {formatNumber(order.filledQuantity, 2)} / {formatNumber(order.quantity, 2)}
                </td>
                {tab === "working" ? (
                  <>
                    <td style={tableCellStyle}>
                      {order.limitPrice != null
                        ? formatMoney(order.limitPrice, currency)
                        : "----"}{" "}
                      /{" "}
                      {order.stopPrice != null ? formatMoney(order.stopPrice, currency) : "----"}
                    </td>
                    <td style={tableCellStyle}>{order.timeInForce}</td>
                    <td style={tableCellStyle}>
                      <Pill tone={order.status === "working" ? "amber" : "accent"}>
                        {order.status}
                      </Pill>
                    </td>
                    <td style={tableCellStyle}>
                      {order.placedAt ? new Date(order.placedAt).toLocaleString() : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      {order.averageFillPrice != null ? formatMoney(order.averageFillPrice, currency) : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      <button
                        type="button"
                        disabled={cancelPending}
                        onClick={() => onCancelOrder(order)}
                        style={{
                          ...secondaryButtonStyle,
                          color: T.red,
                          height: dim(24),
                          padding: sp("0 8px"),
                          opacity: cancelPending ? 0.55 : 1,
                          cursor: cancelPending ? "not-allowed" : "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={tableCellStyle}>
                      {order.placedAt ? new Date(order.placedAt).toLocaleString() : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      {order.filledAt ? new Date(order.filledAt).toLocaleString() : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      {order.averageFillPrice != null ? formatMoney(order.averageFillPrice, currency) : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      {order.commission != null ? formatMoney(order.commission, currency) : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      <Pill tone={order.status === "filled" ? "green" : "default"}>{order.status}</Pill>
                    </td>
                    <td style={tableCellStyle}>{order.source}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Panel>
);

export const ClosedTradesPanel = ({
  query,
  currency,
  filters,
  onFiltersChange,
  onResetFilters,
}) => {
  const rows = query.data?.trades || [];
  return (
    <Panel
      title={`Closed Trades · ${rows.length}`}
      rightRail={query.data?.summary ? `${formatNumber(query.data.summary.count || 0, 0)} trades` : null}
      loading={query.isLoading}
      error={query.error}
      onRetry={query.refetch}
      minHeight={360}
    >
      <div style={{ display: "grid", gap: sp(10) }}>
        <div style={{ display: "grid", gap: sp(6) }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: sp(8), flexWrap: "wrap" }}>
            <ToggleGroup
              options={[
                { value: "all", label: "All" },
                { value: "winners", label: "Winners" },
                { value: "losers", label: "Losers" },
              ]}
              value={filters.pnlSign}
              onChange={(value) => onFiltersChange({ pnlSign: value })}
            />
            <button type="button" onClick={onResetFilters} style={secondaryButtonStyle}>
              Reset
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(110px, 0.85fr) minmax(110px, 0.9fr) minmax(120px, 0.8fr) minmax(120px, 0.8fr) minmax(0, 1.6fr)",
              gap: sp(6),
              alignItems: "center",
            }}
          >
            <input
              value={filters.symbol}
              onChange={(event) => onFiltersChange({ symbol: event.target.value.toUpperCase() })}
              placeholder="Symbol"
              style={controlInputStyle}
            />
            <select
              value={filters.assetClass}
              onChange={(event) => onFiltersChange({ assetClass: event.target.value })}
              style={controlSelectStyle}
            >
              <option value="all">All assets</option>
              <option value="Stocks">Stocks</option>
              <option value="ETF">ETF</option>
              <option value="Options">Options</option>
            </select>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => onFiltersChange({ from: event.target.value })}
              style={controlInputStyle}
            />
            <input
              type="date"
              value={filters.to}
              onChange={(event) => onFiltersChange({ to: event.target.value })}
              style={controlInputStyle}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: sp("6px 12px"),
                paddingLeft: sp(8),
                borderLeft: `1px solid ${T.border}`,
              }}
            >
              <SummaryCard
                label="Trades"
                value={formatNumber(query.data?.summary?.count || 0, 0)}
              />
              <SummaryCard
                label="W / L"
                value={`${formatNumber(query.data?.summary?.winners || 0, 0)} / ${formatNumber(query.data?.summary?.losers || 0, 0)}`}
              />
              <SummaryCard
                label="P&L"
                value={formatMoney(query.data?.summary?.realizedPnl, currency, true)}
                tone={toneForValue(query.data?.summary?.realizedPnl)}
              />
              <SummaryCard
                label="Comms"
                value={formatMoney(query.data?.summary?.commissions, currency, true)}
              />
            </div>
          </div>
        </div>

        {!rows.length ? (
          <EmptyState
            title="No closed trades in this window"
            body="Recent IBKR executions are shown live. Older lifetime trades appear after the Flex refresh imports the Trades section."
          />
        ) : (
          <div style={{ overflow: "auto", maxHeight: 420 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
              <thead>
                <tr style={tableHeaderStyle}>
                  {[
                    "Symbol",
                    "Side",
                    "Qty",
                    "Open Date",
                    "Close Date",
                    "Avg In / Out",
                    "Realized P&L",
                    "Hold",
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
                  <tr key={`${trade.source}:${trade.id}`} tabIndex={0} onKeyDown={moveTableFocus}>
                    <td style={{ ...tableCellStyle, color: T.text, fontWeight: 900 }}>{trade.symbol}</td>
                    <td style={tableCellStyle}>
                      <Pill tone={/buy|long/i.test(trade.side) ? "green" : "red"}>{trade.side}</Pill>
                    </td>
                    <td style={tableCellStyle}>{formatNumber(trade.quantity, 3)}</td>
                    <td style={tableCellStyle}>
                      {trade.openDate ? new Date(trade.openDate).toLocaleDateString() : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      {trade.closeDate ? new Date(trade.closeDate).toLocaleDateString() : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      {trade.avgOpen != null ? formatMoney(trade.avgOpen, currency) : "----"}
                      {" / "}
                      {trade.avgClose != null ? formatMoney(trade.avgClose, currency) : "----"}
                    </td>
                    <td style={{ ...tableCellStyle, color: toneForValue(trade.realizedPnl) }}>
                      {formatMoney(trade.realizedPnl, trade.currency || currency)}{" "}
                      {trade.realizedPnlPercent != null ? `/ ${formatPercent(trade.realizedPnlPercent)}` : ""}
                      {trade.commissions != null ? (
                        <span style={{ color: T.textDim }}>
                          {" · "}
                          {formatMoney(trade.commissions, currency)}
                        </span>
                      ) : null}
                    </td>
                    <td style={tableCellStyle}>
                      {trade.holdDurationMinutes != null
                        ? `${Math.round(trade.holdDurationMinutes / 60)}h`
                        : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      <Pill tone={trade.source === "FLEX" ? "accent" : "green"}>
                        {trade.source}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
};

export default ClosedTradesPanel;
