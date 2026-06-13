import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  dim,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";
import { formatAppDateTime } from "../../lib/timeZone";
import { normalizeLegacyAlgoBrandText } from "../algo/algoBranding.js";
import {
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
  formatAccountMoney,
  formatAccountPrice,
  formatNumber,
  moveTableFocus,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderStyle,
} from "./accountUtils";
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
  const [page, setPage] = useState(0);
  const paginatedOrders = paginateRows(orders, page, ORDERS_PAGE_SIZE);
  const pageOrders = paginatedOrders.pageRows;
  useEffect(() => {
    setPage(0);
  }, [sourceFilter, tab]);
  useEffect(() => {
    if (paginatedOrders.safePage !== page) {
      setPage(paginatedOrders.safePage);
    }
  }, [page, paginatedOrders.safePage]);
  return (
  <Panel
    title="Orders"
    rightRail={`Showing ${tab}`}
    loading={
      (query.isLoading || (query.isPending && query.fetchStatus !== "idle")) &&
      !query.data
    }
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
    ) : (
      <div
        data-testid="account-orders-table-scroll"
        className="ra-hide-scrollbar ra-dense-table-scroll"
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
                          {normalizeLegacyAlgoBrandText(order.deploymentName) || order.candidateId}
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
