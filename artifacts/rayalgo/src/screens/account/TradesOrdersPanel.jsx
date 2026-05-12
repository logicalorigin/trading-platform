import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { useGetBars } from "@workspace/api-client-react";
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
  formatAccountPrice,
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
    <div style={{ color: tone, fontSize: fs(10), fontFamily: T.mono, fontWeight: 400 }}>
      {value}
    </div>
  </div>
);

const marketForAssetClass = (assetClass) =>
  String(assetClass || "").toLowerCase() === "etf" ? "etf" : "stocks";

const mobileFilterRailStyle = {
  display: "flex",
  gap: sp(4),
  flexWrap: "nowrap",
  overflowX: "auto",
  minWidth: 0,
  maxWidth: "100%",
  paddingBottom: sp(1),
  WebkitOverflowScrolling: "touch",
};

const mobileRowListStyle = {
  display: "grid",
  gap: sp(2),
};

const mobileOrdersGrid = "minmax(48px, 0.9fr) minmax(54px, 0.86fr) minmax(58px, 0.92fr) minmax(56px, 0.9fr) 24px";
const mobileTradesGrid = "minmax(48px, 0.92fr) minmax(68px, 1fr) minmax(64px, 0.92fr) minmax(42px, 0.62fr) 24px";

const mobileHeaderStyle = (gridTemplateColumns) => ({
  display: "grid",
  gridTemplateColumns,
  gap: sp(3),
  padding: sp("0 5px"),
  color: T.textDim,
  fontFamily: T.sans,
  fontSize: fs(7),
  letterSpacing: "0.08em",
  textTransform: "uppercase",
});

const mobileScanShellStyle = (active = false) => ({
  border: `1px solid ${T.border}`,
  borderRadius: dim(4),
  background: active ? `${T.cyan}10` : T.bg1,
  boxShadow: active ? `inset 2px 0 0 ${T.cyan}` : "none",
  minWidth: 0,
  overflow: "hidden",
});

const mobileScanRowStyle = (gridTemplateColumns) => ({
  width: "100%",
  minHeight: dim(44),
  padding: sp("4px 5px"),
  border: "none",
  background: "transparent",
  display: "grid",
  gridTemplateColumns,
  gap: sp(3),
  alignItems: "center",
  textAlign: "left",
  cursor: "pointer",
  minWidth: 0,
});

const mobileCellTextStyle = (tone = T.textSec, align = "right") => ({
  color: tone,
  fontFamily: T.data,
  fontSize: fs(9),
  fontWeight: 400,
  textAlign: align,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
});

const mobileDetailStyle = {
  borderTop: `1px solid ${T.border}`,
  padding: sp("6px 7px 7px"),
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: sp("5px 8px"),
};

const mobileIconButtonStyle = {
  width: dim(22),
  height: dim(22),
  padding: 0,
  border: `1px solid ${T.border}`,
  borderRadius: dim(4),
  background: T.bg2,
  color: T.textSec,
  display: "inline-grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const MobileIconButton = ({ label, onClick, children, expanded = null, disabled = false, tone = T.textSec }) => (
  <AppTooltip content={label}>
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded == null ? undefined : expanded}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...mobileIconButtonStyle,
        color: tone,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  </AppTooltip>
);

const MobileDetailMetric = ({ label, value, tone = T.textSec }) => (
  <div style={{ minWidth: 0 }}>
    <div style={mutedLabelStyle}>{label}</div>
    <div style={mobileCellTextStyle(tone, "left")}>{value}</div>
  </div>
);

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
  isPhone = false,
}) => {
  const orders = (query.data?.orders || []).filter((order) =>
    sourceFilter === "all" ? true : order.sourceType === sourceFilter,
  );
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const toggleExpanded = (orderId) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };
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
      <div style={isPhone ? mobileFilterRailStyle : { display: "flex", gap: sp(4), flexWrap: "wrap" }}>
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
    ) : isPhone ? (
      <div
        data-testid="account-orders-row-list"
        style={{
          ...mobileRowListStyle,
          padding: sp("4px 5px 5px"),
        }}
      >
        <div aria-hidden="true" style={mobileHeaderStyle(mobileOrdersGrid)}>
          <span>Symbol</span>
          <span style={{ textAlign: "right" }}>Qty</span>
          <span style={{ textAlign: "right" }}>{tab === "working" ? "Limit" : "Fill"}</span>
          <span style={{ textAlign: "right" }}>Status</span>
          <span />
        </div>
        {orders.map((order) => {
          const expanded = expandedRows.has(order.id);
          const priceLabel =
            tab === "working"
              ? order.limitPrice != null
                ? formatAccountPrice(order.limitPrice, 2, maskValues)
                : order.stopPrice != null
                  ? formatAccountPrice(order.stopPrice, 2, maskValues)
                  : "MKT"
              : order.averageFillPrice != null
                ? formatAccountPrice(order.averageFillPrice, 2, maskValues)
                : "----";
          return (
          <article key={order.id} style={mobileScanShellStyle(expanded)}>
            <div
              data-testid="account-order-scan-row"
              role="button"
              tabIndex={0}
              onClick={() => toggleExpanded(order.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                toggleExpanded(order.id);
              }}
              style={mobileScanRowStyle(mobileOrdersGrid)}
            >
              <div style={{ minWidth: 0 }}>
                <div style={mobileCellTextStyle(T.text, "left")}>{order.symbol}</div>
                <div
                  style={{
                    color: /buy|long/i.test(order.side) ? T.green : T.red,
                    fontFamily: T.data,
                    fontSize: fs(7),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {order.side} · {order.type}
                </div>
              </div>
              <div style={mobileCellTextStyle(T.textSec)}>
                {formatNumber(order.filledQuantity, 1)} / {formatNumber(order.quantity, 1)}
              </div>
              <div style={mobileCellTextStyle(T.textSec)}>{priceLabel}</div>
              <div style={mobileCellTextStyle(order.status === "filled" ? T.green : T.textSec)}>
                {order.status}
              </div>
              <MobileIconButton
                label={expanded ? `Collapse ${order.symbol} order details` : `Expand ${order.symbol} order details`}
                expanded={expanded}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleExpanded(order.id);
                }}
              >
                {expanded ? (
                  <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
                ) : (
                  <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
                )}
              </MobileIconButton>
            </div>
            {expanded ? (
              <div data-testid="account-order-expanded-details" style={mobileDetailStyle}>
                <MobileDetailMetric
                  label={tab === "working" ? "Limit / Stop" : "Avg Fill"}
                  value={
                    tab === "working"
                      ? `${order.limitPrice != null ? formatAccountPrice(order.limitPrice, 2, maskValues) : "----"} / ${order.stopPrice != null ? formatAccountPrice(order.stopPrice, 2, maskValues) : "----"}`
                      : priceLabel
                  }
                />
                <MobileDetailMetric label={tab === "working" ? "TIF" : "Filled"} value={tab === "working" ? order.timeInForce : formatAppDateTime(order.filledAt)} />
                <MobileDetailMetric label="Placed" value={formatAppDateTime(order.placedAt)} />
                <MobileDetailMetric
                  label="Commission"
                  value={order.commission != null ? formatAccountMoney(order.commission, currency, false, maskValues) : "----"}
                />
                <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: sp(4), alignItems: "center" }}>
                  {order.sourceType ? (
                    <Pill tone={sourceTone(order.sourceType)}>
                      {order.strategyLabel || order.sourceType}
                    </Pill>
                  ) : null}
                  {tab === "working" ? (
                    <MobileIconButton
                      label={cancelDisabled ? cancelDisabledReason : "Cancel order"}
                      disabled={cancelPending || cancelDisabled}
                      tone={T.red}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancelOrder(order);
                      }}
                    >
                      <XCircle size={13} strokeWidth={1.8} aria-hidden="true" />
                    </MobileIconButton>
                  ) : null}
                </div>
              </div>
            ) : null}
          </article>
          );
        })}
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
                <td style={{ ...tableCellStyle, color: T.text, fontWeight: 400 }}>
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
                        ? formatAccountPrice(order.limitPrice, 2, maskValues)
                        : "----"}{" "}
                      /{" "}
                      {order.stopPrice != null
                        ? formatAccountPrice(order.stopPrice, 2, maskValues)
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
                        ? formatAccountPrice(order.averageFillPrice, 2, maskValues)
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
                        ? formatAccountPrice(order.averageFillPrice, 2, maskValues)
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
  isPhone = false,
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
          <div
            style={
              isPhone
                ? mobileFilterRailStyle
                : { display: "flex", justifyContent: "space-between", gap: sp(4), flexWrap: "wrap" }
            }
          >
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
              display: isPhone ? "flex" : "grid",
              gridTemplateColumns: isPhone
                ? undefined
                : "minmax(92px, 0.8fr) minmax(96px, 0.85fr) minmax(108px, 0.75fr) minmax(108px, 0.75fr) minmax(0, 1.6fr)",
              gap: sp(4),
              alignItems: "center",
              overflowX: isPhone ? "auto" : undefined,
              paddingBottom: isPhone ? sp(1) : undefined,
              WebkitOverflowScrolling: isPhone ? "touch" : undefined,
            }}
          >
            <input
              value={filters.symbol}
              onChange={(event) => onFiltersChange({ symbol: event.target.value.toUpperCase() })}
              placeholder="Symbol"
              style={{
                ...controlInputStyle,
                ...(isPhone ? { flex: "0 0 76px", minWidth: dim(76) } : null),
              }}
            />
            <select
              value={filters.assetClass}
              onChange={(event) => onFiltersChange({ assetClass: event.target.value })}
              style={{
                ...controlSelectStyle,
                ...(isPhone ? { flex: "0 0 94px", minWidth: dim(94) } : null),
              }}
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
              style={{
                ...controlInputStyle,
                ...(isPhone ? { flex: "0 0 112px", minWidth: dim(112) } : null),
              }}
            />
            <input
              type="date"
              value={filters.to}
              onChange={(event) => onFiltersChange({ to: event.target.value })}
              style={{
                ...controlInputStyle,
                ...(isPhone ? { flex: "0 0 112px", minWidth: dim(112) } : null),
              }}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: sp("3px 8px"),
                paddingLeft: isPhone ? 0 : sp(5),
                borderLeft: isPhone ? "none" : `1px solid ${T.border}`,
                flex: isPhone ? "0 0 220px" : undefined,
                minWidth: isPhone ? dim(220) : undefined,
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
        ) : isPhone ? (
          <div
            data-testid="account-trades-row-list"
            style={mobileRowListStyle}
          >
            <div aria-hidden="true" style={mobileHeaderStyle(mobileTradesGrid)}>
              <span>Symbol</span>
              <span style={{ textAlign: "right" }}>P&L</span>
              <span style={{ textAlign: "right" }}>Close</span>
              <span style={{ textAlign: "right" }}>Hold</span>
              <span />
            </div>
            {rows.map((trade) => {
              const tradeId = getAccountTradeId(trade);
              const rowSelected = Boolean(selectedTradeId && tradeId === selectedTradeId);
              return (
                <article
                  key={`${trade.source}:${trade.id}`}
                  style={mobileScanShellStyle(rowSelected)}
                >
                  <div
                    data-testid="account-trade-scan-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => onTradeSelect?.(rowSelected ? "" : tradeId)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onTradeSelect?.(rowSelected ? "" : tradeId);
                    }}
                    style={mobileScanRowStyle(mobileTradesGrid)}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={mobileCellTextStyle(T.text, "left")}>{trade.symbol}</div>
                      <div
                        style={{
                          color: /buy|long/i.test(trade.side) ? T.green : T.red,
                          fontFamily: T.data,
                          fontSize: fs(7),
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {trade.side} · {formatNumber(trade.quantity, 2)}
                      </div>
                    </div>
                    <div style={mobileCellTextStyle(toneForValue(trade.realizedPnl))}>
                      {formatAccountMoney(trade.realizedPnl, trade.currency || currency, true, maskValues)}
                    </div>
                    <div style={mobileCellTextStyle(T.textSec)}>{formatAppDate(trade.closeDate)}</div>
                    <div style={mobileCellTextStyle(T.textSec)}>
                      {trade.holdDurationMinutes != null ? `${Math.round(trade.holdDurationMinutes / 60)}h` : "----"}
                    </div>
                    <MobileIconButton
                      label={rowSelected ? `Collapse ${trade.symbol} trade details` : `Expand ${trade.symbol} trade details`}
                      expanded={rowSelected}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTradeSelect?.(rowSelected ? "" : tradeId);
                      }}
                    >
                      {rowSelected ? (
                        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
                      )}
                    </MobileIconButton>
                  </div>
                  {rowSelected ? (
                    <div data-testid="account-trade-expanded-details" style={mobileDetailStyle}>
                      <MobileDetailMetric
                        label="Realized %"
                        value={trade.realizedPnlPercent != null ? formatAccountPercent(trade.realizedPnlPercent, 2, maskValues) : "----"}
                        tone={toneForValue(trade.realizedPnlPercent)}
                      />
                      <MobileDetailMetric label="Open" value={formatAppDate(trade.openDate)} />
                      <MobileDetailMetric
                        label="Avg In / Out"
                        value={`${trade.avgOpen != null ? formatAccountPrice(trade.avgOpen, 2, maskValues) : "----"} / ${trade.avgClose != null ? formatAccountPrice(trade.avgClose, 2, maskValues) : "----"}`}
                      />
                      <MobileDetailMetric
                        label="Fees"
                        value={trade.commissions != null ? formatAccountMoney(trade.commissions, currency, false, maskValues) : "----"}
                      />
                      <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: sp(4) }}>
                        <Pill tone={trade.source === "FLEX" ? "accent" : "green"}>
                          {trade.source}
                        </Pill>
                        {trade.sourceType ? (
                          <Pill tone={sourceTone(trade.sourceType)}>
                            {trade.strategyLabel || trade.sourceType}
                          </Pill>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
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
                      <td style={{ ...tableCellStyle, ...selectedCellStyle, color: T.text, fontWeight: 400 }}>
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
                          ? formatAccountPrice(trade.avgOpen, 2, maskValues)
                          : "----"}
                        {" / "}
                        {trade.avgClose != null
                          ? formatAccountPrice(trade.avgClose, 2, maskValues)
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
        fontWeight: 400,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value ?? "----"}
    </div>
  </div>
);

const TRADE_CHART_HEIGHT = 110;

const pickBarsTimeframe = (holdMinutes) => {
  const minutes = Number(holdMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return "1h";
  if (minutes < 240) return "5m";
  if (minutes < 5 * 24 * 60) return "15m";
  if (minutes < 30 * 24 * 60) return "1h";
  return "1d";
};

const TradePriceChart = ({ trade, currency, maskValues }) => {
  const symbol = String(trade?.symbol || "").trim();
  const rawOpenMs = trade?.openDate ? new Date(trade.openDate).getTime() : NaN;
  const rawCloseMs = trade?.closeDate ? new Date(trade.closeDate).getTime() : NaN;
  const holdMinutes = Number(trade?.holdDurationMinutes);
  // Derive a missing endpoint from the hold duration when possible so the
  // chart can render for Flex-sourced trades that only carry one timestamp.
  let openMs = rawOpenMs;
  let closeMs = rawCloseMs;
  if (!Number.isFinite(openMs) && Number.isFinite(closeMs) && Number.isFinite(holdMinutes) && holdMinutes > 0) {
    openMs = closeMs - holdMinutes * 60_000;
  } else if (!Number.isFinite(closeMs) && Number.isFinite(openMs) && Number.isFinite(holdMinutes) && holdMinutes > 0) {
    closeMs = openMs + holdMinutes * 60_000;
  }
  const hasWindow = Number.isFinite(openMs) && Number.isFinite(closeMs) && closeMs > openMs;
  const timeframe = pickBarsTimeframe(holdMinutes);
  const padding = hasWindow ? Math.max(60_000, (closeMs - openMs) * 0.1) : 0;
  const fromIso = hasWindow ? new Date(openMs - padding).toISOString() : undefined;
  const toIso = hasWindow ? new Date(closeMs + padding).toISOString() : undefined;
  const enabled = Boolean(symbol && hasWindow);
  const barsQuery = useGetBars(
    enabled
      ? {
          symbol,
          timeframe,
          from: fromIso,
          to: toIso,
          limit: 500,
        }
      : { symbol: "", timeframe: "1m" },
    {
      query: {
        enabled,
        staleTime: 60_000,
        retry: false,
      },
    },
  );
  const bars = useMemo(() => {
    if (!enabled) return [];
    const raw = barsQuery.data?.bars || [];
    return raw
      .map((bar) => {
        const ts = bar?.timestamp ? new Date(bar.timestamp).getTime() : NaN;
        const close = Number(bar?.close);
        if (!Number.isFinite(ts) || !Number.isFinite(close)) return null;
        return { ts, close };
      })
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts);
  }, [enabled, barsQuery.data]);

  if (!enabled) {
    return (
      <div
        style={{
          border: `1px dashed ${T.border}`,
          borderRadius: dim(4),
          background: T.bg0,
          color: T.textMuted,
          fontFamily: T.data,
          fontSize: fs(9),
          padding: sp("6px 8px"),
          textAlign: "center",
        }}
      >
        Trade window unavailable — open or close timestamp missing.
      </div>
    );
  }
  if (!barsQuery.isLoading && bars.length < 2) {
    return (
      <div
        style={{
          border: `1px dashed ${T.border}`,
          borderRadius: dim(4),
          background: T.bg0,
          color: T.textMuted,
          fontFamily: T.data,
          fontSize: fs(9),
          padding: sp("6px 8px"),
          textAlign: "center",
        }}
      >
        Bars unavailable for {symbol} during this trade window.
      </div>
    );
  }

  const W = 600;
  const H = TRADE_CHART_HEIGHT;
  const padL = 40;
  const padR = 8;
  const padT = 6;
  const padB = 14;
  if (barsQuery.isLoading || !bars.length) {
    return (
      <div
        style={{
          height: dim(H),
          border: `1px solid ${T.border}`,
          borderRadius: dim(4),
          background: T.bg0,
          color: T.textMuted,
          display: "grid",
          placeItems: "center",
          fontFamily: T.data,
          fontSize: fs(9),
        }}
      >
        Loading bars…
      </div>
    );
  }
  const tMin = Math.min(bars[0].ts, openMs);
  const tMax = Math.max(bars[bars.length - 1].ts, closeMs);
  const span = tMax - tMin || 1;
  const closes = bars.map((b) => b.close);
  const referencePrices = [Number(trade?.avgOpen), Number(trade?.avgClose)].filter(Number.isFinite);
  const yMin = Math.min(...closes, ...referencePrices);
  const yMax = Math.max(...closes, ...referencePrices);
  const yPad = (yMax - yMin) * 0.06 || 1;
  const yLow = yMin - yPad;
  const yHigh = yMax + yPad;
  const yRange = yHigh - yLow || 1;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const xFor = (ts) => padL + ((ts - tMin) / span) * chartW;
  const yFor = (val) => padT + chartH - ((val - yLow) / yRange) * chartH;
  const pathPoints = bars
    .map((bar) => ({
      x: xFor(bar.ts),
      y: yFor(bar.close),
      close: bar.close,
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.close));
  if (pathPoints.length < 2) {
    return (
      <div
        style={{
          border: `1px dashed ${T.border}`,
          borderRadius: dim(4),
          background: T.bg0,
          color: T.textMuted,
          fontFamily: T.data,
          fontSize: fs(9),
          padding: sp("6px 8px"),
          textAlign: "center",
        }}
      >
        Bars unavailable for {symbol} during this trade window.
      </div>
    );
  }
  const linePath = pathPoints
    .map((point, idx) => `${idx === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
  const lastClose = pathPoints[pathPoints.length - 1].close;
  const firstClose = pathPoints[0].close;
  const tradeShortSide = /short|sell/i.test(trade?.side || "");
  const lineTone = tradeShortSide
    ? lastClose <= firstClose
      ? T.green
      : T.red
    : lastClose >= firstClose
      ? T.green
      : T.red;
  const areaPath = `${linePath} L${pathPoints[pathPoints.length - 1].x.toFixed(1)},${(padT + chartH).toFixed(1)} L${padL},${(padT + chartH).toFixed(1)} Z`;

  const entryPx = Number(trade?.avgOpen);
  const exitPx = Number(trade?.avgClose);
  const entryX = xFor(openMs);
  const exitX = xFor(closeMs);

  return (
    <div style={{ display: "grid", gap: sp(2) }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: sp(4),
        }}
      >
        <div style={mutedLabelStyle}>
          {symbol} · {timeframe} BARS
        </div>
        <div style={{ fontSize: fs(8), fontFamily: T.data, color: T.textDim }}>
          {bars.length} bars
        </div>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <defs>
          <linearGradient id={`tradeChartGrad-${symbol}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={lineTone} stopOpacity={0.18} />
            <stop offset="100%" stopColor={lineTone} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#tradeChartGrad-${symbol})`} />
        <path d={linePath} stroke={lineTone} strokeWidth={1.2} fill="none" />
        {Number.isFinite(entryPx) ? (
          <g>
            <title>{`Entry · ${formatAccountPrice(entryPx, 2, maskValues)} · ${formatAppDateTime(openMs)}`}</title>
            <line
              x1={entryX}
              x2={entryX}
              y1={padT}
              y2={padT + chartH}
              stroke={T.green}
              strokeWidth={0.6}
              strokeDasharray="2 2"
              opacity={0.6}
            />
            <circle cx={entryX} cy={yFor(entryPx)} r={4} fill={T.green} stroke={T.bg1} strokeWidth={1} />
            <text
              x={entryX + 4}
              y={yFor(entryPx) - 6}
              fill={T.green}
              fontFamily={T.data}
              fontSize={9}
              fontWeight={400}
            >
              ENTRY
            </text>
          </g>
        ) : null}
        {Number.isFinite(exitPx) ? (
          <g>
            <title>{`Exit · ${formatAccountPrice(exitPx, 2, maskValues)} · ${formatAppDateTime(closeMs)}`}</title>
            <line
              x1={exitX}
              x2={exitX}
              y1={padT}
              y2={padT + chartH}
              stroke={T.red}
              strokeWidth={0.6}
              strokeDasharray="2 2"
              opacity={0.6}
            />
            <circle cx={exitX} cy={yFor(exitPx)} r={4} fill={T.red} stroke={T.bg1} strokeWidth={1} />
            <text
              x={exitX - 4}
              y={yFor(exitPx) - 6}
              fill={T.red}
              fontFamily={T.data}
              fontSize={9}
              fontWeight={400}
              textAnchor="end"
            >
              EXIT
            </text>
          </g>
        ) : null}
        <text
          x={padL}
          y={padT + chartH + 11}
          fill={T.textMuted}
          fontFamily={T.data}
          fontSize={9}
          textAnchor="start"
        >
          {formatAppDate(tMin)}
        </text>
        <text
          x={W - padR}
          y={padT + chartH + 11}
          fill={T.textMuted}
          fontFamily={T.data}
          fontSize={9}
          textAnchor="end"
        >
          {formatAppDate(tMax)}
        </text>
        <text
          x={padL - 4}
          y={padT + 4}
          fill={T.textMuted}
          fontFamily={T.data}
          fontSize={9}
          textAnchor="end"
        >
	          {formatAccountPrice(yHigh, 2, maskValues)}
        </text>
        <text
          x={padL - 4}
          y={padT + chartH}
          fill={T.textMuted}
          fontFamily={T.data}
          fontSize={9}
          textAnchor="end"
        >
	          {formatAccountPrice(yLow, 2, maskValues)}
        </text>
      </svg>
    </div>
  );
};

const lifecycleToneColor = (tone) =>
  tone === "green" ? T.green : tone === "red" ? T.red : T.cyan;

const LifecycleTimeline = ({ rows = [], currency, maskValues }) => {
  if (!rows.length) return null;
  const priceEventKeys = new Set(["entry", "order", "exit"]);
  const formatLifecycleValue = (row, compact = false) => {
    if (row?.value == null) return null;
    if (typeof row.value !== "number") return row.value;
    return priceEventKeys.has(row.key)
      ? formatAccountPrice(row.value, 2, maskValues)
      : formatAccountMoney(row.value, currency, compact, maskValues);
  };
  const events = rows
    .map((row) => {
      const ts = row?.at ? new Date(row.at).getTime() : NaN;
      return Number.isFinite(ts) ? { ...row, ts } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
  const tSpan =
    events.length >= 2 ? events[events.length - 1].ts - events[0].ts : 0;
  // Less than ~1 minute of total span means everything would stack on a single
  // x-position — fall back to the legible text-row layout instead.
  if (events.length < 2 || tSpan < 60_000) {
    return (
      <div style={{ display: "grid", gap: sp(3) }}>
        <div style={mutedLabelStyle}>TRADE LIFECYCLE</div>
        {rows.map((row) => (
          <div
            key={row.key}
            style={{
              display: "grid",
              gridTemplateColumns: "auto minmax(0, 1fr) auto",
              gap: sp(5),
              border: `1px solid ${T.border}`,
              borderRadius: dim(4),
              background: T.bg0,
              padding: sp("4px 5px"),
              alignItems: "center",
              fontFamily: T.data,
              fontSize: fs(8),
            }}
          >
            <span style={{ color: T.text, fontWeight: 400 }}>{row.label}</span>
            <span style={{ color: T.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.detail}
            </span>
            <span style={{ color: lifecycleToneColor(row.tone), fontWeight: 400 }}>
              {row.value == null
                ? row.at
                  ? formatAppDate(row.at)
                  : ""
                : formatLifecycleValue(row, true)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  const tMin = events[0].ts;
  const tMax = events[events.length - 1].ts;
  const span = tMax - tMin;
  const W = 600;
  const H = 64;
  const padX = 40;
  const padTop = 16;
  const padBottom = 18;
  const trackY = padTop + (H - padTop - padBottom) / 2;
  const xFor = (ts) => padX + ((ts - tMin) / span) * (W - padX * 2);
  // De-overlap markers: when events share an x within 16px, vertical stack
  const placements = events.map((event, idx) => {
    const baseX = xFor(event.ts);
    let stackIdx = 0;
    for (let i = 0; i < idx; i += 1) {
      if (Math.abs(xFor(events[i].ts) - baseX) < 16) stackIdx += 1;
    }
    return { ...event, x: baseX, stack: stackIdx };
  });
  return (
    <div style={{ display: "grid", gap: sp(3) }}>
      <div style={mutedLabelStyle}>TRADE LIFECYCLE</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <line
          x1={padX}
          x2={W - padX}
          y1={trackY}
          y2={trackY}
          stroke={T.border}
          strokeWidth={1}
        />
        <text
          x={padX}
          y={H - 4}
          fill={T.textMuted}
          fontFamily={T.data}
          fontSize={9}
          textAnchor="start"
        >
          {formatAppDate(events[0].ts)}
        </text>
        <text
          x={W - padX}
          y={H - 4}
          fill={T.textMuted}
          fontFamily={T.data}
          fontSize={9}
          textAnchor="end"
        >
          {formatAppDate(events[events.length - 1].ts)}
        </text>
        {placements.map((event) => {
          const color = lifecycleToneColor(event.tone);
          const cy = trackY - event.stack * 10;
          return (
            <g key={event.key}>
              <title>
                {`${event.label} · ${event.detail}${
                  event.value == null
                    ? ""
                    : ` · ${formatLifecycleValue(event, true)}`
                } · ${formatAppDateTime(event.ts)}`}
              </title>
              <line
                x1={event.x}
                x2={event.x}
                y1={cy}
                y2={trackY}
                stroke={color}
                strokeWidth={0.6}
                opacity={0.6}
              />
              <circle cx={event.x} cy={cy} r={4} fill={color} stroke={T.bg1} strokeWidth={1} />
              <text
                x={event.x}
                y={cy - 7}
                fill={color}
                fontFamily={T.data}
                fontSize={9}
                fontWeight={400}
                textAnchor="middle"
              >
                {event.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

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

          <TradePriceChart trade={trade} currency={currency} maskValues={maskValues} />

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
                  : formatAccountPrice(trade.avgOpen, 2, maskValues)
              }
            />
            <DetailRow
              label="Exit"
              value={
                trade.avgClose == null
                  ? "----"
                  : formatAccountPrice(trade.avgClose, 2, maskValues)
              }
            />
            <DetailRow label="Opened" value={formatAppDateTime(trade.openDate)} />
            <DetailRow label="Closed" value={formatAppDateTime(trade.closeDate)} />
            <DetailRow
              label="Exit Reason"
              value={trade.exitReason ? String(trade.exitReason).replaceAll("_", " ") : "----"}
            />
            <DetailRow
              label="Contract"
              value={
                trade.optionRight || trade.strike || trade.expirationDate
                  ? `${String(trade.optionRight || trade.selectedContract?.right || "option").toUpperCase()} ${
                      trade.strike ?? trade.selectedContract?.strike ?? "strike"
                    } ${trade.expirationDate || trade.selectedContract?.expirationDate || ""}`.trim()
                  : "----"
              }
            />
            <DetailRow
              label="DTE / Slot"
              value={`${trade.dte == null ? "----" : formatNumber(trade.dte, 0)} / ${
                trade.strikeSlot == null ? "----" : formatNumber(trade.strikeSlot, 0)
              }`}
            />
            <DetailRow
              label="MFE / Giveback"
              value={`${trade.mfePercent == null ? "----" : formatAccountPercent(trade.mfePercent, 0, maskValues)} / ${
                trade.givebackPercent == null
                  ? "----"
                  : formatAccountPercent(trade.givebackPercent, 0, maskValues)
              }`}
            />
            <DetailRow
              label="Regime"
              value={
                trade.adx == null && !Array.isArray(trade.mtfDirections)
                  ? "----"
                  : `ADX ${trade.adx == null ? "----" : formatNumber(trade.adx, 1)} · MTF ${
                      Array.isArray(trade.mtfDirections) ? trade.mtfDirections.join("/") : "----"
                    }`
              }
            />
          </div>

          <LifecycleTimeline
            rows={lifecycleRows}
            currency={currency}
            maskValues={maskValues}
          />

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
