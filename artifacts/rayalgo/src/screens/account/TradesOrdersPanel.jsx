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
import { closeDateMatchesPatternHour } from "./accountPatternLens";
import {
  feeDragBucket,
  getAccountTradeId,
  holdDurationBucket,
} from "./accountTradingAnalysis";
import { AppTooltip } from "@/components/ui/tooltip";


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

const normalizeText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const normalizeSymbol = (value) => normalizeText(value).toUpperCase();

const tradeStrategyValue = (trade) =>
  normalizeText(
    trade?.strategyLabel,
    normalizeText(trade?.deploymentName, normalizeText(trade?.candidateId, "Unattributed")),
  );

const tradeMatchesExtendedFilters = (trade, filters = {}) => {
  if (filters.symbol && normalizeSymbol(trade.symbol) !== normalizeSymbol(filters.symbol)) {
    return false;
  }
  if (
    filters.assetClass &&
    filters.assetClass !== "all" &&
    normalizeText(trade.assetClass).toLowerCase() !==
      normalizeText(filters.assetClass).toLowerCase()
  ) {
    return false;
  }
  if (filters.pnlSign === "winners" && Number(trade.realizedPnl || 0) <= 0) {
    return false;
  }
  if (filters.pnlSign === "losers" && Number(trade.realizedPnl || 0) >= 0) {
    return false;
  }
  if (
    filters.side &&
    filters.side !== "all" &&
    !normalizeText(trade.side).toLowerCase().includes(String(filters.side).toLowerCase())
  ) {
    return false;
  }
  if (
    filters.holdDuration &&
    filters.holdDuration !== "all" &&
    holdDurationBucket(trade.holdDurationMinutes) !== filters.holdDuration
  ) {
    return false;
  }
  if (
    filters.strategy &&
    filters.strategy !== "all" &&
    tradeStrategyValue(trade) !== filters.strategy
  ) {
    return false;
  }
  if (
    filters.feeDrag &&
    filters.feeDrag !== "all" &&
    feeDragBucket(trade) !== filters.feeDrag
  ) {
    return false;
  }
  return closeDateMatchesPatternHour(trade.closeDate, filters.closeHour);
};

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
                      <AppTooltip content={cancelDisabled ? cancelDisabledReason : "Cancel order"}><button
                        type="button"
                        className="ra-interactive"
                        disabled={cancelPending || cancelDisabled}
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
                      </button></AppTooltip>
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
  selectedTradeId = "",
  onTradeSelect,
}) => {
  const rows = (query.data?.trades || []).filter((trade) =>
    (!sourceFiltersEnabled || !filters.sourceType || filters.sourceType === "all"
      ? true
      : trade.sourceType === filters.sourceType) &&
    tradeMatchesExtendedFilters(trade, filters),
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
            <ToggleGroup
              options={[
                { value: "all", label: "All Holds" },
                { value: "intraday-fast", label: "<=30m" },
                { value: "intraday", label: "30m-4h" },
                { value: "swing", label: "4h-1d" },
                { value: "multi-day", label: "Multi-day" },
              ]}
              value={filters.holdDuration || "all"}
              onChange={(value) => onFiltersChange({ holdDuration: value })}
            />
            <ToggleGroup
              options={[
                { value: "all", label: "All Fees" },
                { value: "high", label: "High Fee" },
                { value: "medium", label: "Med Fee" },
                { value: "low", label: "Low Fee" },
              ]}
              value={filters.feeDrag || "all"}
              onChange={(value) => onFiltersChange({ feeDrag: value })}
            />
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
                {rows.map((trade) => {
                  const tradeId = getAccountTradeId(trade);
                  const rowSelected = Boolean(selectedTradeId && tradeId === selectedTradeId);
                  const selectedCellStyle = rowSelected
                    ? {
                        borderTop: `1px solid ${T.cyan}55`,
                        borderBottom: `1px solid ${T.cyan}55`,
                      }
                    : {};
                  return (
                    <AppTooltip key={`${trade.source}:${trade.id}`} content={onTradeSelect ? "Inspect trade" : undefined}><tr
                      key={`${trade.source}:${trade.id}`}
                      className="ra-table-row"
                      tabIndex={0}
                      onClick={() => onTradeSelect?.(tradeId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onTradeSelect?.(tradeId);
                          return;
                        }
                        moveTableFocus(event);
                      }}
                      style={{
                        background: rowSelected ? `${T.cyan}16` : "transparent",
                        boxShadow: rowSelected ? `inset 3px 0 0 ${T.cyan}` : "none",
                        cursor: onTradeSelect ? "pointer" : "default",
                      }}
                    >
                      <td style={{ ...tableCellStyle, ...selectedCellStyle, color: T.text, fontWeight: 900 }}>
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
                      <td style={{ ...tableCellStyle, ...selectedCellStyle }}>
                        <Pill tone={/buy|long/i.test(trade.side) ? "green" : "red"}>{trade.side}</Pill>
                      </td>
                      <td style={{ ...tableCellStyle, ...selectedCellStyle }}>{formatNumber(trade.quantity, 3)}</td>
                      <td style={{ ...tableCellStyle, ...selectedCellStyle }}>
                        {formatAppDate(trade.openDate)}
                      </td>
                      <td style={{ ...tableCellStyle, ...selectedCellStyle }}>
                        {formatAppDate(trade.closeDate)}
                      </td>
                      <td style={{ ...tableCellStyle, ...selectedCellStyle }}>
                        {trade.avgOpen != null
                          ? formatAccountMoney(trade.avgOpen, currency, false, maskValues)
                          : "----"}
                        {" / "}
                        {trade.avgClose != null
                          ? formatAccountMoney(trade.avgClose, currency, false, maskValues)
                          : "----"}
                      </td>
                      <td style={{ ...tableCellStyle, ...selectedCellStyle, color: toneForValue(trade.realizedPnl) }}>
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
                      <td style={{ ...tableCellStyle, ...selectedCellStyle }}>
                        {trade.holdDurationMinutes != null
                          ? `${Math.round(trade.holdDurationMinutes / 60)}h`
                          : "----"}
                      </td>
                      <td style={{ ...tableCellStyle, ...selectedCellStyle }}>
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
                    </tr></AppTooltip>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
};

const DetailRow = ({ label, value, tone = T.textSec }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "minmax(92px, 0.55fr) minmax(0, 1fr)",
      gap: sp(5),
      alignItems: "baseline",
      minWidth: 0,
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div
      style={{
        color: tone,
        fontFamily: T.data,
        fontSize: fs(9),
        fontWeight: 800,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value ?? "----"}
    </div>
  </div>
);

export const SelectedTradeAnalysisPanel = ({
  analysis,
  currency,
  maskValues = false,
  onJumpToChart,
}) => {
  const detail = analysis?.selectedTradeDetail;
  const trade = detail?.trade;
  const lifecycleRows = analysis?.lifecycleRows || [];
  return (
    <Panel
      title="Selected Trade"
      rightRail={trade ? getAccountTradeId(trade) : "No trade selected"}
      minHeight={170}
      action={
        trade?.symbol && onJumpToChart ? (
          <button
            type="button"
            className="ra-interactive"
            onClick={() => onJumpToChart(trade.symbol)}
            style={secondaryButtonStyle}
          >
            Chart
          </button>
        ) : null
      }
    >
      {!trade ? (
        <EmptyState
          title="No selected trade"
          body="Select a closed trade or pattern card to inspect account impact."
        />
      ) : (
        <div style={{ display: "grid", gap: sp(7) }}>
          <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
            <Pill tone="cyan">{trade.symbol || "----"}</Pill>
            <Pill tone={/sell|short/i.test(trade.side) ? "red" : "green"}>
              {trade.side || "side"}
            </Pill>
            <Pill tone={sourceTone(trade.sourceType)}>
              {trade.strategyLabel || trade.sourceType || trade.source || "source"}
            </Pill>
            {trade.assetClass ? <Pill tone="purple">{trade.assetClass}</Pill> : null}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: sp(5),
            }}
          >
            <DetailRow
              label="Realized"
              value={formatAccountMoney(trade.realizedPnl, trade.currency || currency, true, maskValues)}
              tone={toneForValue(trade.realizedPnl)}
            />
            <DetailRow
              label="Commissions"
              value={formatAccountMoney(trade.commissions, currency, true, maskValues)}
            />
            <DetailRow label="Quantity" value={formatNumber(trade.quantity, 3)} />
            <DetailRow
              label="Hold"
              value={
                trade.holdDurationMinutes == null
                  ? "----"
                  : `${formatNumber(trade.holdDurationMinutes / 60, 1)}h`
              }
            />
            <DetailRow
              label="Entry"
              value={
                trade.avgOpen == null
                  ? "----"
                  : formatAccountMoney(trade.avgOpen, currency, false, maskValues)
              }
            />
            <DetailRow
              label="Exit"
              value={
                trade.avgClose == null
                  ? "----"
                  : formatAccountMoney(trade.avgClose, currency, false, maskValues)
              }
            />
            <DetailRow label="Opened" value={formatAppDateTime(trade.openDate)} />
            <DetailRow label="Closed" value={formatAppDateTime(trade.closeDate)} />
          </div>

          <div style={{ display: "grid", gap: sp(4) }}>
            <div style={mutedLabelStyle}>TRADE LIFECYCLE</div>
            {lifecycleRows.map((row) => (
              <div
                key={row.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(82px, 0.35fr) minmax(0, 1fr) auto",
                  gap: sp(5),
                  border: `1px solid ${T.border}`,
                  borderRadius: dim(4),
                  background: T.bg0,
                  padding: sp("4px 5px"),
                  alignItems: "center",
                  minWidth: 0,
                }}
              >
                <span style={{ color: T.text, fontFamily: T.data, fontWeight: 900, fontSize: fs(8) }}>
                  {row.label}
                </span>
                <span
                  style={{
                    color: T.textSec,
                    fontSize: fs(8),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.detail}
                </span>
                <span style={{ color: row.tone === "red" ? T.red : row.tone === "green" ? T.green : T.textDim, fontFamily: T.data, fontSize: fs(8), fontWeight: 900 }}>
                  {row.value == null
                    ? formatAppDate(row.at)
                    : typeof row.value === "number"
                      ? formatAccountMoney(row.value, currency, true, maskValues)
                      : row.value}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap", color: T.textDim, fontSize: fs(8), fontFamily: T.data }}>
            <span>{detail.relatedOrders?.length || 0} related orders</span>
            <span>{detail.relatedPositions?.length || 0} related open positions</span>
            {trade.candidateId ? <span>candidate {trade.candidateId}</span> : null}
          </div>
        </div>
      )}
    </Panel>
  );
};

export default ClosedTradesPanel;
