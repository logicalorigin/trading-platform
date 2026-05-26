import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import {
  CSS_COLOR,
  cssColorMix,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatAppDateTime } from "../../lib/timeZone";
import {
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
  cellSubTextStyle,
  formatAccountMoney,
  formatAccountPrice,
  formatNumber,
  moveTableFocus,
  mutedLabelStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderStyle,
} from "./accountUtils";
import { Icon } from "../../components/platform/primitives.jsx";
import { PaginationFooter, paginateRows } from "../../components/platform/TablePagination.jsx";
import { AppTooltip } from "@/components/ui/tooltip";

const ORDERS_PAGE_SIZE = 25;

const marketForAssetClass = (assetClass) => {
  const normalized = String(assetClass || "").toLowerCase();
  if (normalized === "etf") return "etf";
  if (normalized === "options") return "options";
  return "stocks";
};

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
  gap: sp(1),
};

const mobileOrdersGrid = "minmax(48px, 0.9fr) minmax(54px, 0.86fr) minmax(58px, 0.92fr) minmax(56px, 0.9fr) 24px";

const mobileHeaderStyle = (gridTemplateColumns) => ({
  display: "grid",
  gridTemplateColumns,
  gap: sp(3),
  padding: sp("0 5px"),
  color: CSS_COLOR.textDim,
  fontFamily: T.sans,
  fontSize: textSize("caption"),
  letterSpacing: 0,
  textTransform: "uppercase",
});

const mobileHeaderEndStyle = { textAlign: "right" };
const mobileMinWidthStyle = { minWidth: 0 };
const mobileOrderListPaddingStyle = {
  ...mobileRowListStyle,
  padding: sp("4px 5px 5px"),
};
const mobileDetailWideFlexStyle = {
  gridColumn: "1 / -1",
  display: "flex",
  flexWrap: "wrap",
  gap: sp(4),
  alignItems: "center",
};
const mobileScanShellStyle = (active = false) => ({
  border: "none",
  borderRadius: dim(RADII.xs),
  background: active ? `${cssColorMix(CSS_COLOR.cyan, 6)}` : CSS_COLOR.bg1,
  boxShadow: active ? `inset 2px 0 0 ${CSS_COLOR.cyan}` : "none",
  minWidth: 0,
  overflow: "hidden",
});

const mobileScanRowStyle = (gridTemplateColumns) => ({
  width: "100%",
  minHeight: dim(40),
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

const mobileCellTextStyle = (tone = CSS_COLOR.textSec, align = "right") => ({
  color: tone,
  fontFamily: T.data,
  fontSize: textSize("body"),
  fontWeight: FONT_WEIGHTS.medium,
  fontVariantNumeric: "tabular-nums",
  textAlign: align,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
});

const mobileDetailStyle = {
  borderTop: `1px solid ${CSS_COLOR.border}`,
  padding: sp("6px 7px 7px"),
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: sp("5px 8px"),
};

const mobileIconButtonStyle = {
  width: dim(22),
  height: dim(22),
  padding: 0,
  border: "none",
  borderRadius: dim(RADII.xs),
  background: CSS_COLOR.bg1,
  color: CSS_COLOR.textSec,
  display: "inline-grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const MobileIconButton = ({ label, onClick, children, expanded = null, disabled = false, tone = CSS_COLOR.textSec, ...buttonProps }) => (
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
      {...buttonProps}
    >
      {children}
    </button>
  </AppTooltip>
);

const MobileDetailMetric = ({ label, value, tone = CSS_COLOR.textSec }) => (
  <div style={{ minWidth: 0 }}>
    <div style={mutedLabelStyle}>{label}</div>
    <div style={mobileCellTextStyle(tone, "left")}>{value}</div>
  </div>
);

const SOURCE_FILTERS = [
  { value: "all", label: "All Sources" },
  { value: "manual", label: "Manual" },
  { value: "automation", label: "Automation" },
  { value: "watchlist_backtest", label: "Watchlist BT" },
];

const sourceTone = (sourceType) =>
  sourceType === "automation"
    ? "category-automation"
    : sourceType === "watchlist_backtest"
      ? "category-backtest"
      : sourceType === "mixed"
        ? "category-mixed"
      : "default";

const orderMobileRowSignature = (order) =>
  JSON.stringify([
    order?.id,
    order?.symbol,
    order?.side,
    order?.type,
    order?.filledQuantity,
    order?.quantity,
    order?.limitPrice,
    order?.stopPrice,
    order?.averageFillPrice,
    order?.status,
    order?.timeInForce,
    order?.placedAt,
    order?.filledAt,
    order?.commission,
    order?.sourceType,
    order?.strategyLabel,
  ]);

const MobileOrderRow = memo(({
  order,
  orderId = order?.id,
  expanded,
  tab,
  currency,
  maskValues,
  cancelPending,
  cancelDisabled,
  cancelDisabledReason,
  onRowAction,
  onRowKeyDown,
}) => {
  const priceLabel =
    tab === "working"
      ? order.limitPrice != null
        ? formatAccountPrice(order.limitPrice, 2, maskValues)
        : order.stopPrice != null
          ? formatAccountPrice(order.stopPrice, 2, maskValues)
          : "MKT"
      : order.averageFillPrice != null
        ? formatAccountPrice(order.averageFillPrice, 2, maskValues)
        : "—";

  return (
    <article style={mobileScanShellStyle(expanded)}>
      <div
        data-testid="account-order-scan-row"
        data-action="toggle"
        data-row-id={orderId}
        role="button"
        tabIndex={0}
        onClick={onRowAction}
        onKeyDown={onRowKeyDown}
        style={mobileScanRowStyle(mobileOrdersGrid)}
      >
        <div style={mobileMinWidthStyle}>
          <div style={mobileCellTextStyle(CSS_COLOR.text, "left")}>{order.symbol}</div>
          <div style={cellSubTextStyle(/buy|long/i.test(order.side) ? "var(--ra-side-buy)" : "var(--ra-side-sell)")}>
            {order.side} · {order.type}
          </div>
        </div>
        <div style={mobileCellTextStyle(CSS_COLOR.textSec)}>
          {formatNumber(order.filledQuantity, 1)} / {formatNumber(order.quantity, 1)}
        </div>
        <div style={mobileCellTextStyle(CSS_COLOR.textSec)}>{priceLabel}</div>
        <div style={mobileCellTextStyle(order.status === "filled" ? "var(--ra-status-filled)" : CSS_COLOR.textSec)}>
          {order.status}
        </div>
        <MobileIconButton
          label={expanded ? `Collapse ${order.symbol} order details` : `Expand ${order.symbol} order details`}
          data-action="expand"
          data-row-id={orderId}
          expanded={expanded}
          onClick={onRowAction}
        >
          {expanded ? (
            <Icon as={ChevronDown} context="inline" aria-hidden="true" />
          ) : (
            <Icon as={ChevronRight} context="inline" aria-hidden="true" />
          )}
        </MobileIconButton>
      </div>
      {expanded ? (
        <div data-testid="account-order-expanded-details" style={mobileDetailStyle}>
          <MobileDetailMetric
            label={tab === "working" ? "Limit / Stop" : "Avg Fill"}
            value={
              tab === "working"
                ? `${order.limitPrice != null ? formatAccountPrice(order.limitPrice, 2, maskValues) : "—"} / ${order.stopPrice != null ? formatAccountPrice(order.stopPrice, 2, maskValues) : "—"}`
                : priceLabel
            }
          />
          <MobileDetailMetric label={tab === "working" ? "TIF" : "Filled"} value={tab === "working" ? order.timeInForce : formatAppDateTime(order.filledAt)} />
          <MobileDetailMetric label="Placed" value={formatAppDateTime(order.placedAt)} />
          <MobileDetailMetric
            label="Commission"
            value={order.commission != null ? formatAccountMoney(order.commission, currency, false, maskValues) : "—"}
          />
          <div style={mobileDetailWideFlexStyle}>
            {order.sourceType ? (
              <Pill tone={sourceTone(order.sourceType)}>
                {order.strategyLabel || order.sourceType}
              </Pill>
            ) : null}
            {tab === "working" ? (
              <MobileIconButton
                label={cancelDisabled ? cancelDisabledReason : "Cancel order"}
                data-action="cancel"
                data-row-id={orderId}
                disabled={cancelPending || cancelDisabled}
                tone={CSS_COLOR.red}
                onClick={onRowAction}
              >
                <XCircle size={13} strokeWidth={1.8} aria-hidden="true" />
              </MobileIconButton>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}, (previous, next) => (
  previous.orderId === next.orderId &&
  previous.expanded === next.expanded &&
  previous.tab === next.tab &&
  previous.currency === next.currency &&
  previous.maskValues === next.maskValues &&
  previous.cancelPending === next.cancelPending &&
  previous.cancelDisabled === next.cancelDisabled &&
  previous.cancelDisabledReason === next.cancelDisabledReason &&
  previous.onRowAction === next.onRowAction &&
  previous.onRowKeyDown === next.onRowKeyDown &&
  (
  previous.order === next.order ||
  orderMobileRowSignature(previous.order) === orderMobileRowSignature(next.order)
  )
));

const normalizeText = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

export const getAccountOrderId = (order) => {
  if (!order) return "";
  const fallbackId = [
    order.accountId,
    order.symbol,
    order.side,
    order.type,
    order.placedAt,
    order.filledAt,
    order.quantity,
    order.status,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(":");
  return normalizeText(order.id, fallbackId || "order");
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
  const orders = useMemo(
    () =>
      (query.data?.orders || []).filter((order) =>
        sourceFilter === "all" ? true : order.sourceType === sourceFilter,
      ),
    [query.data?.orders, sourceFilter],
  );
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [page, setPage] = useState(0);
  const paginatedOrders = paginateRows(orders, page, ORDERS_PAGE_SIZE);
  const pageOrders = paginatedOrders.pageRows;
  const ordersById = useMemo(
    () => new Map(orders.map((order) => [getAccountOrderId(order), order])),
    [orders],
  );
  const ordersByIdRef = useRef(ordersById);
  const onCancelOrderRef = useRef(onCancelOrder);
  ordersByIdRef.current = ordersById;
  onCancelOrderRef.current = onCancelOrder;
  const toggleExpanded = useCallback((orderId) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }, []);
  useEffect(() => {
    setPage(0);
  }, [sourceFilter, tab]);
  useEffect(() => {
    if (paginatedOrders.safePage !== page) {
      setPage(paginatedOrders.safePage);
    }
  }, [page, paginatedOrders.safePage]);
  const handleOrderRowAction = useCallback(
    (event) => {
      const { action, rowId } = event.currentTarget.dataset;
      if (!rowId) {
        return;
      }
      if (action === "cancel") {
        event.stopPropagation();
        const order = ordersByIdRef.current.get(rowId);
        if (order) {
          onCancelOrderRef.current?.(order);
        }
        return;
      }
      if (action === "expand") {
        event.stopPropagation();
      }
      toggleExpanded(rowId);
    },
    [toggleExpanded],
  );
  const handleOrderRowKeyDown = useCallback(
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      handleOrderRowAction(event);
    },
    [handleOrderRowAction],
  );
  return (
  <Panel
    title="Orders"
    rightRail={`Showing ${tab}`}
    loading={(query.isPending || query.isLoading) && !query.data}
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
        style={mobileOrderListPaddingStyle}
      >
        <div aria-hidden="true" style={mobileHeaderStyle(mobileOrdersGrid)}>
          <span>Symbol</span>
          <span style={mobileHeaderEndStyle}>Qty</span>
          <span style={mobileHeaderEndStyle}>{tab === "working" ? "Limit" : "Fill"}</span>
          <span style={mobileHeaderEndStyle}>Status</span>
          <span />
        </div>
        {pageOrders.map((order) => {
          const orderId = getAccountOrderId(order);
          return (
            <MobileOrderRow
              key={orderId}
              order={order}
              orderId={orderId}
              expanded={expandedRows.has(orderId)}
              tab={tab}
              currency={currency}
              maskValues={maskValues}
              cancelPending={cancelPending}
              cancelDisabled={cancelDisabled}
              cancelDisabledReason={cancelDisabledReason}
              onRowAction={handleOrderRowAction}
              onRowKeyDown={handleOrderRowKeyDown}
            />
          );
        })}
      </div>
    ) : (
      <div
        data-testid="account-orders-table-scroll"
        className="ra-hide-scrollbar"
        style={{ overflowX: "auto" }}
      >
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
          <thead>
            <tr style={tableHeaderStyle}>
              {(tab === "working"
                ? ["Symbol", "Side", "Type", "Qty", "Limit / Stop", "TIF", "Status", "Placed", "Avg Fill", "Action"]
                : ["Symbol", "Side", "Type", "Qty", "Placed", "Filled", "Avg Fill", "Commission", "Status", "Source"]).map((column) => (
                <th key={column} className="ra-table-header-sticky" style={{ ...tableCellStyle, ...tableHeaderStyle }}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageOrders.map((order) => {
              const orderId = getAccountOrderId(order);
              return (
                <tr
                key={orderId}
                className="ra-table-row"
                tabIndex={0}
                onKeyDown={moveTableFocus}
              >
                <td style={{ ...tableCellStyle, color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.regular }}>
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
                  <Pill tone={/buy|long/i.test(order.side) ? "side-buy" : "side-sell"}>{order.side}</Pill>
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
                        : "—"}{" "}
                      /{" "}
                      {order.stopPrice != null
                        ? formatAccountPrice(order.stopPrice, 2, maskValues)
                        : "—"}
                    </td>
                    <td style={tableCellStyle}>{order.timeInForce}</td>
                    <td style={tableCellStyle}>
                      <Pill tone={order.status === "working" ? "status-working" : "status-filled"}>
                        {order.status}
                      </Pill>
                    </td>
                    <td style={tableCellStyle}>
                      {formatAppDateTime(order.placedAt)}
                    </td>
                    <td style={tableCellStyle}>
                      {order.averageFillPrice != null
                        ? formatAccountPrice(order.averageFillPrice, 2, maskValues)
                        : "—"}
                    </td>
                    <td style={tableCellStyle}>
                      <AppTooltip content={cancelDisabled ? cancelDisabledReason : "Cancel order"}><button
                        type="button"
                        className="ra-interactive"
                        disabled={cancelPending || cancelDisabled}
                        onClick={() => onCancelOrder(order)}
                        style={{
                          ...secondaryButtonStyle,
                          color: CSS_COLOR.red,
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
                        : "—"}
                    </td>
                    <td style={tableCellStyle}>
                      {order.commission != null
                        ? formatAccountMoney(order.commission, currency, false, maskValues)
                        : "—"}
                    </td>
                    <td style={tableCellStyle}>
                      <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
                        <Pill tone={order.status === "filled" ? "status-filled" : "default"}>{order.status}</Pill>
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
                        <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("body"), marginTop: sp(2) }}>
                          {order.deploymentName || order.candidateId}
                        </div>
                      ) : null}
                    </td>
                  </>
                )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
	    )}
      <PaginationFooter
        dataTestId="account-orders-pagination"
        label="Rows"
        onPageChange={setPage}
        page={paginatedOrders.safePage}
        pageCount={paginatedOrders.pageCount}
        pageSize={ORDERS_PAGE_SIZE}
        total={paginatedOrders.total}
        style={{ padding: sp("6px 10px 8px"), borderTop: `1px solid ${CSS_COLOR.border}` }}
      />
	  </Panel>
  );
};

export default OrdersPanel;
