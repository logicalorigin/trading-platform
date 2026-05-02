import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import { formatAppDate, formatAppDateTime } from "../../lib/timeZone";
import {
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
  controlInputStyle,
  controlSelectStyle,
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
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
      padding: sp("3px 0"),
      display: "grid",
      gap: sp(1),
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div style={{ color: tone, fontSize: fs(10), fontFamily: T.mono, fontWeight: 900 }}>
      {value}
    </div>
  </div>
);

const marketForAssetClass = (assetClass) =>
  String(assetClass || "").toLowerCase() === "etf" ? "etf" : "stocks";

const SOURCE_FILTERS = [
  { value: "all", label: "All Sources" },
  { value: "manual", label: "Manual" },
  { value: "automation", label: "Automation" },
  { value: "watchlist_backtest", label: "Backtest" },
];

const sourceTone = (sourceType) =>
  sourceType === "automation"
    ? "pink"
    : sourceType === "watchlist_backtest"
      ? "purple"
      : sourceType === "mixed"
        ? "amber"
        : "default";

export const OrdersPanel = ({
  query,
  tab,
  onTabChange,
  currency,
  onCancelOrder,
  cancelPending,
  cancelDisabled = false,
  cancelDisabledReason = "IB Gateway must be connected before trading.",
  sourceFilter = "all",
  onSourceFilterChange,
  emptyBody = "Working orders update from the IBKR order stream. Historical rows appear as orders reach a terminal status.",
  maskValues = false,
}) => {
  const orders = (query.data?.orders || []).filter((order) =>
    sourceFilter === "all" ? true : order.sourceType === sourceFilter,
  );
  return (
  <Panel
    title="Orders"
    rightRail={`Showing ${tab}`}
    loading={query.isLoading}
    error={query.error}
    onRetry={query.refetch}
    minHeight={168}
    noPad
    action={
      <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
        <ToggleGroup
          options={[
            { value: "working", label: "Working" },
            { value: "history", label: "History" },
          ]}
          value={tab}
          onChange={onTabChange}
        />
        {onSourceFilterChange ? (
          <ToggleGroup
            options={SOURCE_FILTERS}
            value={sourceFilter}
            onChange={onSourceFilterChange}
          />
        ) : null}
      </div>
    }
  >
    {!orders.length ? (
      <div style={{ padding: sp(7) }}>
        <EmptyState
          title={`No ${tab} orders`}
          body={emptyBody}
        />
      </div>
    ) : (
      <div className="ra-hide-scrollbar" style={{ overflow: "auto", maxHeight: 248 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
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
            {orders.map((order) => (
              <tr
                key={order.id}
                className="ra-table-row"
                tabIndex={0}
                onKeyDown={moveTableFocus}
              >
                <td style={{ ...tableCellStyle, color: T.text, fontWeight: 900 }}>
                  <MarketIdentityInline
                    item={{
                      ticker: order.symbol,
                      market: marketForAssetClass(order.assetClass),
                    }}
                    size={14}
                    showMark={false}
                    showChips
                    style={{ maxWidth: dim(126) }}
                  />
                </td>
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
                        ? formatAccountMoney(order.limitPrice, currency, false, maskValues)
                        : "----"}{" "}
                      /{" "}
                      {order.stopPrice != null
                        ? formatAccountMoney(order.stopPrice, currency, false, maskValues)
                        : "----"}
                    </td>
                    <td style={tableCellStyle}>{order.timeInForce}</td>
                    <td style={tableCellStyle}>
                      <Pill tone={order.status === "working" ? "amber" : "accent"}>
                        {order.status}
                      </Pill>
                    </td>
                    <td style={tableCellStyle}>
                      {formatAppDateTime(order.placedAt)}
                    </td>
                    <td style={tableCellStyle}>
                      {order.averageFillPrice != null
                        ? formatAccountMoney(order.averageFillPrice, currency, false, maskValues)
                        : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      <button
                        type="button"
                        className="ra-interactive"
                        disabled={cancelPending || cancelDisabled}
                        title={cancelDisabled ? cancelDisabledReason : "Cancel order"}
                        onClick={() => onCancelOrder(order)}
                        style={{
                          ...secondaryButtonStyle,
                          color: T.red,
                          height: dim(20),
                          padding: sp("0 7px"),
                          opacity: cancelPending || cancelDisabled ? 0.55 : 1,
                          cursor:
                            cancelPending || cancelDisabled
                              ? "not-allowed"
                              : "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={tableCellStyle}>
                      {formatAppDateTime(order.placedAt)}
                    </td>
                    <td style={tableCellStyle}>
                      {formatAppDateTime(order.filledAt)}
                    </td>
                    <td style={tableCellStyle}>
                      {order.averageFillPrice != null
                        ? formatAccountMoney(order.averageFillPrice, currency, false, maskValues)
                        : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      {order.commission != null
                        ? formatAccountMoney(order.commission, currency, false, maskValues)
                        : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
                        <Pill tone={order.status === "filled" ? "green" : "default"}>{order.status}</Pill>
                        {order.sourceType ? (
                          <Pill tone={sourceTone(order.sourceType)}>
                            {order.strategyLabel || order.sourceType}
                          </Pill>
                        ) : null}
                      </div>
                    </td>
                    <td style={tableCellStyle}>
                      {order.strategyLabel || order.source}
                      {order.candidateId ? (
                        <div style={{ color: T.textDim, fontSize: fs(8), marginTop: 2 }}>
                          {order.deploymentName || order.candidateId}
                        </div>
                      ) : null}
                    </td>
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
};

export const ClosedTradesPanel = ({
  query,
  currency,
  filters,
  onFiltersChange,
  onResetFilters,
  sourceFiltersEnabled = false,
  emptyBody = "Recent IBKR executions are shown live. Older lifetime trades appear after the Flex refresh imports the Trades section.",
  maskValues = false,
}) => {
  const rows = (query.data?.trades || []).filter((trade) =>
    !sourceFiltersEnabled || !filters.sourceType || filters.sourceType === "all"
      ? true
      : trade.sourceType === filters.sourceType,
  );
  return (
    <Panel
      title={`Closed Trades · ${rows.length}`}
      rightRail={query.data?.summary ? `${formatNumber(query.data.summary.count || 0, 0)} trades` : null}
      loading={query.isLoading}
      error={query.error}
      onRetry={query.refetch}
      minHeight={196}
    >
      <div style={{ display: "grid", gap: sp(6) }}>
        <div style={{ display: "grid", gap: sp(4) }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: sp(4), flexWrap: "wrap" }}>
            <ToggleGroup
              options={[
                { value: "all", label: "All" },
                { value: "winners", label: "Winners" },
                { value: "losers", label: "Losers" },
              ]}
              value={filters.pnlSign}
              onChange={(value) => onFiltersChange({ pnlSign: value })}
            />
            {sourceFiltersEnabled ? (
              <ToggleGroup
                options={SOURCE_FILTERS}
                value={filters.sourceType || "all"}
                onChange={(value) => onFiltersChange({ sourceType: value })}
              />
            ) : null}
            <button type="button" onClick={onResetFilters} style={secondaryButtonStyle}>
              Reset
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(92px, 0.8fr) minmax(96px, 0.85fr) minmax(108px, 0.75fr) minmax(108px, 0.75fr) minmax(0, 1.6fr)",
              gap: sp(4),
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
                gap: sp("3px 8px"),
                paddingLeft: sp(5),
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
                value={formatAccountMoney(query.data?.summary?.realizedPnl, currency, true, maskValues)}
                tone={toneForValue(query.data?.summary?.realizedPnl)}
              />
              <SummaryCard
                label="Comms"
                value={formatAccountMoney(query.data?.summary?.commissions, currency, true, maskValues)}
              />
            </div>
          </div>
        </div>

        {!rows.length ? (
          <EmptyState
            title="No closed trades in this window"
            body={emptyBody}
          />
        ) : (
          <div className="ra-hide-scrollbar" style={{ overflow: "auto", maxHeight: 278 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1040 }}>
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
                  <tr
                    key={`${trade.source}:${trade.id}`}
                    className="ra-table-row"
                    tabIndex={0}
                    onKeyDown={moveTableFocus}
                  >
                    <td style={{ ...tableCellStyle, color: T.text, fontWeight: 900 }}>
                      <MarketIdentityInline
                        item={{
                          ticker: trade.symbol,
                          market: marketForAssetClass(trade.assetClass),
                        }}
                        size={14}
                        showMark={false}
                        showChips
                        style={{ maxWidth: dim(126) }}
                      />
                    </td>
                    <td style={tableCellStyle}>
                      <Pill tone={/buy|long/i.test(trade.side) ? "green" : "red"}>{trade.side}</Pill>
                    </td>
                    <td style={tableCellStyle}>{formatNumber(trade.quantity, 3)}</td>
                    <td style={tableCellStyle}>
                      {formatAppDate(trade.openDate)}
                    </td>
                    <td style={tableCellStyle}>
                      {formatAppDate(trade.closeDate)}
                    </td>
                    <td style={tableCellStyle}>
                      {trade.avgOpen != null
                        ? formatAccountMoney(trade.avgOpen, currency, false, maskValues)
                        : "----"}
                      {" / "}
                      {trade.avgClose != null
                        ? formatAccountMoney(trade.avgClose, currency, false, maskValues)
                        : "----"}
                    </td>
                    <td style={{ ...tableCellStyle, color: toneForValue(trade.realizedPnl) }}>
                      {formatAccountMoney(trade.realizedPnl, trade.currency || currency, false, maskValues)}{" "}
                      {trade.realizedPnlPercent != null
                        ? `/ ${formatAccountPercent(trade.realizedPnlPercent, 2, maskValues)}`
                        : ""}
                      {trade.commissions != null ? (
                        <span style={{ color: T.textDim }}>
                          {" · "}
                          {formatAccountMoney(trade.commissions, currency, false, maskValues)}
                        </span>
                      ) : null}
                    </td>
                    <td style={tableCellStyle}>
                      {trade.holdDurationMinutes != null
                        ? `${Math.round(trade.holdDurationMinutes / 60)}h`
                        : "----"}
                    </td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
                        <Pill tone={trade.source === "FLEX" ? "accent" : "green"}>
                          {trade.source}
                        </Pill>
                        {trade.sourceType ? (
                          <Pill tone={sourceTone(trade.sourceType)}>
                            {trade.strategyLabel || trade.sourceType}
                          </Pill>
                        ) : null}
                      </div>
                      {trade.candidateId ? (
                        <div style={{ color: T.textDim, fontSize: fs(8), marginTop: 2 }}>
                          {trade.deploymentName || trade.candidateId}
                        </div>
                      ) : null}
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
