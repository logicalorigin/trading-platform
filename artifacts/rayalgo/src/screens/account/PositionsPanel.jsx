import { Fragment, memo, useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, LineChart } from "lucide-react";
import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import { RADII, T, dim, fs, sp } from "../../lib/uiTokens";
import { formatAppDateTime } from "../../lib/timeZone";
import {
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
  cellSubTextStyle,
  formatAccountMoney,
  formatAccountPercent,
  formatAccountPrice,
  formatAccountSignedMoney,
  formatNumber,
  moveTableFocus,
  mutedLabelStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderStyle,
  toneForValue,
} from "./accountUtils";
import { isOpenPositionRow } from "../../features/account/accountPositionRows.js";
import { buildPositionsAtDateInspectorState } from "./positionsAtDateInspectorModel.js";
import { AppTooltip } from "@/components/ui/tooltip";

const ASSET_FILTERS = [
  { value: "all", label: "All" },
  { value: "Stocks", label: "Stock" },
  { value: "ETF", label: "ETF" },
  { value: "Options", label: "Option" },
];

const SOURCE_FILTERS = [
  { value: "all", label: "All Sources" },
  { value: "manual", label: "Manual" },
  { value: "automation", label: "Automation" },
  { value: "signal_options_replay", label: "Options BT" },
  { value: "watchlist_backtest", label: "Watchlist BT" },
  { value: "mixed", label: "Mixed" },
];

const sourceTone = (sourceType) =>
  sourceType === "automation"
    ? "category-automation"
    : sourceType === "signal_options_replay"
      ? "category-replay"
    : sourceType === "watchlist_backtest"
      ? "category-backtest"
      : sourceType === "mixed"
        ? "category-mixed"
        : "default";

const compactKeyPart = (value) => String(value ?? "").trim();

const positionOpenOrderKey = (rowId, order, index) =>
  [
    rowId,
    order?.id,
    order?.accountId,
    order?.symbol,
    order?.side,
    order?.type,
    order?.placedAt,
    index,
  ]
    .map(compactKeyPart)
    .filter(Boolean)
    .join(":");

const positionSourceAttributionKey = (rowId, source, index) =>
  [
    rowId,
    source?.candidateId,
    source?.sourceEventId,
    source?.sourceType,
    source?.quantity,
    index,
  ]
    .map(compactKeyPart)
    .filter(Boolean)
    .join(":");

const headerCellStyle = (active) => ({
  ...tableCellStyle,
  ...tableHeaderStyle,
  color: active ? T.accent : T.textMuted,
});

const SortButton = ({ id, label, sort, setSort, align = "right" }) => (
  <button
    type="button"
    onClick={() =>
      setSort((current) => ({
        id,
        dir: current.id === id && current.dir === "desc" ? "asc" : "desc",
      }))
    }
    style={{
      border: "none",
      background: "transparent",
      color: "inherit",
      font: "inherit",
      cursor: "pointer",
      textTransform: "inherit",
      letterSpacing: "inherit",
      width: "100%",
      textAlign: align,
      padding: 0,
    }}
  >
    {label} {sort.id === id ? (sort.dir === "desc" ? "▼" : "▲") : ""}
  </button>
);

const lotColumns = ["Account", "Qty", "Avg Cost", "Market Value", "Unrealized"];

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
  gap: sp(2),
  padding: sp("4px 5px 5px"),
};

const mobilePositionGrid = "minmax(44px, 0.76fr) minmax(54px, 0.88fr) minmax(46px, 0.7fr) minmax(54px, 0.82fr) minmax(50px, 0.76fr) 48px";

const mobileHeaderStyle = {
  display: "grid",
  gridTemplateColumns: mobilePositionGrid,
  gap: sp(3),
  padding: sp("0 5px"),
  color: T.textDim,
  fontFamily: T.sans,
  fontSize: fs(7),
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const mobileHeaderEndStyle = { textAlign: "right" };
const mobileMinWidthStyle = { minWidth: 0 };
const mobileActionRailStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: sp(2),
};
const mobilePillWrapStyle = {
  display: "flex",
  gap: sp(3),
  flexWrap: "wrap",
};
const mobileTaxLotRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: sp(5),
  color: T.textSec,
  fontFamily: T.data,
  fontSize: fs(8),
};

const mobileScanShellStyle = (active = false) => ({
  border: "none",
  borderRadius: dim(RADII.xs),
  background: active ? `${T.cyan}10` : T.bg1,
  boxShadow: active ? `inset 2px 0 0 ${T.cyan}` : "none",
  minWidth: 0,
  overflow: "hidden",
});

const mobileScanRowStyle = {
  width: "100%",
  minHeight: dim(44),
  padding: sp("4px 5px"),
  border: "none",
  background: "transparent",
  display: "grid",
  gridTemplateColumns: mobilePositionGrid,
  gap: sp(3),
  alignItems: "center",
  textAlign: "left",
  cursor: "pointer",
  minWidth: 0,
};

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
  border: "none",
  borderRadius: dim(RADII.xs),
  background: T.bg2,
  color: T.textSec,
  display: "inline-grid",
  placeItems: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const MobileIconButton = ({ label, onClick, children, expanded = null, ...buttonProps }) => (
  <AppTooltip content={label}>
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded == null ? undefined : expanded}
      onClick={onClick}
      style={mobileIconButtonStyle}
      {...buttonProps}
    >
      {children}
    </button>
  </AppTooltip>
);

const MobileMetric = ({ label, value, tone = T.text }) => (
  <div style={{ minWidth: 0 }}>
    <div style={mutedLabelStyle}>{label}</div>
    <div
      style={{
        color: tone,
        fontFamily: T.data,
        fontSize: fs(10),
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </div>
  </div>
);

const MobileDetailMetric = ({ label, value, tone = T.textSec }) => (
  <div style={{ minWidth: 0 }}>
    <div style={mutedLabelStyle}>{label}</div>
    <div style={mobileCellTextStyle(tone, "left")}>{value}</div>
  </div>
);

const positionMobileRowSignature = (row) =>
  JSON.stringify([
    row?.id,
    row?.symbol,
    row?.quantity,
    row?.assetClass,
    row?.mark,
    row?.dayChange,
    row?.dayChangePercent,
    row?.unrealizedPnl,
    row?.unrealizedPnlPercent,
    row?.marketValue,
    row?.averageCost,
    row?.weightPercent,
    row?.sourceType,
    row?.strategyLabel,
    row?.accounts,
    row?.openOrders,
    row?.lots,
  ]);

const MobilePositionRow = memo(({
  row,
  expanded,
  currency,
  maskValues,
  onRowAction,
  onRowKeyDown,
}) => (
  <article style={mobileScanShellStyle(expanded)}>
    <div
      data-testid="account-position-scan-row"
      data-action="toggle"
      data-row-id={row.id}
      role="button"
      tabIndex={0}
      onClick={onRowAction}
      onKeyDown={onRowKeyDown}
      style={mobileScanRowStyle}
    >
      <div style={mobileMinWidthStyle}>
        <div style={mobileCellTextStyle(T.text, "left")}>{row.symbol}</div>
        <div style={cellSubTextStyle(T.textDim)}>
          {row.quantity < 0 ? "Short" : "Long"} · {row.assetClass || "Position"}
        </div>
      </div>
      <div
        title={`${formatNumber(row.quantity, 4)} @ ${formatAccountPrice(row.mark, 2, maskValues)}`}
        style={mobileCellTextStyle(row.quantity < 0 ? T.red : T.textSec)}
      >
        {formatNumber(row.quantity, 3)} @ {formatAccountPrice(row.mark, 2, maskValues)}
      </div>
      <div style={mobileCellTextStyle(toneForValue(row.dayChange))}>
        {formatAccountMoney(row.dayChange, currency, true, maskValues)}
      </div>
      <div style={mobileCellTextStyle(toneForValue(row.unrealizedPnl))}>
        {formatAccountMoney(row.unrealizedPnl, currency, true, maskValues)}
      </div>
      <div style={mobileCellTextStyle(T.textSec)}>
        {formatAccountMoney(row.marketValue, currency, true, maskValues)}
      </div>
      <div style={mobileActionRailStyle}>
        <MobileIconButton
          label={`Open ${row.symbol} chart`}
          data-action="chart"
          data-row-id={row.id}
          data-symbol={row.symbol}
          onClick={onRowAction}
        >
          <LineChart size={13} strokeWidth={1.8} aria-hidden="true" />
        </MobileIconButton>
        <MobileIconButton
          label={expanded ? `Collapse ${row.symbol} details` : `Expand ${row.symbol} details`}
          data-action="expand"
          data-row-id={row.id}
          expanded={expanded}
          onClick={onRowAction}
        >
          {expanded ? (
            <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
          )}
        </MobileIconButton>
      </div>
    </div>
    {expanded ? (
      <div
        data-testid="account-position-expanded-details"
        style={mobileDetailStyle}
      >
        <MobileDetailMetric label="Avg Cost" value={formatAccountPrice(row.averageCost, 2, maskValues)} />
        <MobileDetailMetric
          label="Unreal %"
          value={formatAccountPercent(row.unrealizedPnlPercent, 2, maskValues)}
          tone={toneForValue(row.unrealizedPnlPercent)}
        />
        <MobileDetailMetric
          label="Day %"
          value={formatAccountPercent(row.dayChangePercent, 2, maskValues)}
          tone={toneForValue(row.dayChangePercent)}
        />
        <MobileDetailMetric label="Weight" value={formatAccountPercent(row.weightPercent, 2, maskValues)} />
        <div style={mobileMinWidthStyle}>
          <div style={{ ...mutedLabelStyle, marginBottom: sp(3) }}>Accounts</div>
          <div style={mobilePillWrapStyle}>
            {(row.accounts || []).slice(0, 3).map((accountId) => (
              <Pill key={`${row.id}:${accountId}`} tone="cyan">
                {accountId}
              </Pill>
            ))}
            {row.sourceType ? (
              <Pill tone={sourceTone(row.sourceType)}>
                {row.strategyLabel || row.sourceType}
              </Pill>
            ) : null}
          </div>
        </div>
        <div style={mobileMinWidthStyle}>
          <div style={{ ...mutedLabelStyle, marginBottom: sp(3) }}>Orders</div>
          {row.openOrders?.length ? (
            <div style={mobilePillWrapStyle}>
              {row.openOrders.slice(0, 3).map((order, index) => (
                <Pill
                  key={positionOpenOrderKey(row.id, order, index)}
                  tone={/buy/i.test(order.side) ? "side-buy" : "side-sell"}
                >
                  {order.side} {formatNumber(order.quantity, 2)}
                </Pill>
              ))}
            </div>
          ) : (
            <div style={{ color: T.textMuted, fontSize: fs(9) }}>No working orders.</div>
          )}
        </div>
        <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
          <div style={{ ...mutedLabelStyle, marginBottom: sp(3) }}>Tax Lots</div>
          {row.lots?.length ? (
            <div style={{ display: "grid", gap: sp(2) }}>
              {row.lots.slice(0, 4).map((lot, index) => (
                <div
                  key={`${row.id}:mobile-lot:${index}`}
                  style={mobileTaxLotRowStyle}
                >
                  <span>{lot.accountId} · {formatNumber(lot.quantity, 4)} @ {formatAccountPrice(lot.averageCost, 2, maskValues)}</span>
                  <span style={{ color: toneForValue(lot.unrealizedPnl) }}>
                    {formatAccountMoney(lot.unrealizedPnl, currency, false, maskValues)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: T.textMuted, fontSize: fs(10) }}>
              No tax-lot detail recorded yet.
            </div>
          )}
        </div>
      </div>
    ) : null}
  </article>
), (previous, next) => (
  previous.expanded === next.expanded &&
  previous.currency === next.currency &&
  previous.maskValues === next.maskValues &&
  previous.onRowAction === next.onRowAction &&
  previous.onRowKeyDown === next.onRowKeyDown &&
  (
    previous.row === next.row ||
    positionMobileRowSignature(previous.row) === positionMobileRowSignature(next.row)
  )
));

const dateLabel = (date) => {
  if (!date) return "Live";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
};

const ActivityTone = ({ activity }) => {
  const tone = activity?.type === "trade_buy"
    ? "side-buy"
    : activity?.type === "trade_sell"
      ? "side-sell"
      : Number(activity?.amount) >= 0
        ? "pnl-positive"
        : "pnl-negative";
  return (
    <Pill tone={tone}>
      {String(activity?.type || "event").replace(/_/g, " ")}
    </Pill>
  );
};

export const PositionsAtDateInspector = ({
  query,
  activeDate,
  pinnedDate,
  currentPositionsCount = 0,
  currency,
  maskValues = false,
  onClearPin,
  onJumpToChart,
}) => {
  const data = query.data || null;
  const inspecting = Boolean(activeDate);
  const inspectorState = buildPositionsAtDateInspectorState({
    activeDate,
    pinnedDate,
    response: data,
    currentPositionsCount,
  });
  const positions = inspectorState.positions;
  const activity = inspectorState.activity;
  const balance = inspectorState.balance;
  const title = pinnedDate
    ? `Positions @ ${dateLabel(pinnedDate)}`
    : activeDate
      ? `Positions @ ${dateLabel(activeDate)}`
      : inspectorState.title;

  return (
    <Panel
      title={title}
      rightRail={
        inspecting
          ? inspectorState.rightRail
          : `${formatNumber(currentPositionsCount, 0)} current positions`
      }
      loading={Boolean(inspecting && query.isLoading)}
      error={query.error}
      onRetry={query.refetch}
      minHeight={136}
      action={
        pinnedDate ? (
          <button
            type="button"
            className="ra-interactive"
            onClick={onClearPin}
            style={secondaryButtonStyle}
          >
            Clear Pin
          </button>
        ) : null
      }
    >
      {!inspecting ? (
        <EmptyState
          title="Move over the equity curve"
          body="Hover a date to preview that day's positions and activity. Click the chart to pin the date for inspection."
        />
      ) : inspectorState.unavailable ? (
        <EmptyState
          title="No positions for this date"
          body={inspectorState.message || "No historical position snapshot or account activity exists for the selected date."}
        />
      ) : (
        <div style={{ display: "grid", gap: sp(6) }}>
          {balance ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fit, minmax(${dim(118)}px, 1fr))`,
                gap: sp(5),
              }}
            >
              {[
                ["Net Liq", formatAccountMoney(balance.netLiquidation, currency, false, maskValues), T.text],
                ["Day P&L", formatAccountSignedMoney(balance.dayPnl, currency, false, maskValues), toneForValue(balance.dayPnl)],
                ["Cash", formatAccountMoney(balance.cash, currency, false, maskValues), T.text],
                ["Buying Power", formatAccountMoney(balance.buyingPower, currency, false, maskValues), T.text],
              ].map(([label, value, color]) => (
                <div
                  key={label}
                  style={{
                    border: "none",
                    borderRadius: dim(RADII.xs),
                    background: T.bg0,
                    padding: sp("5px 6px"),
                    minWidth: 0,
                  }}
                >
                  <div style={mutedLabelStyle}>{label}</div>
                  <div
                    style={{
                      marginTop: sp(2),
                      color,
                      fontFamily: T.data,
                      fontSize: fs(11),
                      fontWeight: 400,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
            <Pill tone="cyan">
              {positions.length} positions
            </Pill>
            <Pill tone="purple">
              {activity.length} activity rows
            </Pill>
            {balance?.dayPnlPercent != null ? (
              <Pill tone={Number(balance.dayPnlPercent) >= 0 ? "pnl-positive" : "pnl-negative"}>
                {formatAccountPercent(balance.dayPnlPercent, 2, maskValues)}
              </Pill>
            ) : null}
            {data?.snapshotDate ? (
              <Pill tone="default">
                as of {formatAppDateTime(data.snapshotDate)}
              </Pill>
            ) : null}
          </div>
          {!positions.length && inspectorState.message ? (
            <div style={{ color: T.textMuted, fontSize: fs(9), lineHeight: 1.35 }}>
              {inspectorState.message}
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: `minmax(0, 1fr) minmax(${dim(280)}px, 0.8fr)`,
              gap: sp(7),
              alignItems: "start",
            }}
          >
            <div className="ra-hide-scrollbar" style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead>
                  <tr style={tableHeaderStyle}>
                    {["Symbol", "Qty", "Mark", "Unreal P&L", "Mkt Value"].map((column) => (
                      <th key={column} style={{ ...tableCellStyle, ...tableHeaderStyle }}>
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.slice(0, 8).map((row) => (
                    <tr key={row.id} className="ra-table-row">
                      <td style={{ ...tableCellStyle, color: T.text, fontWeight: 400 }}>
                        <button
                          type="button"
                          onClick={() => onJumpToChart?.(row.symbol)}
                          style={{
                            border: "none",
                            padding: 0,
                            background: "transparent",
                            color: T.text,
                            cursor: "pointer",
                          }}
                        >
                          <MarketIdentityInline
                            item={{
                              ticker: row.symbol,
                              name: row.description || row.symbol,
                              market: marketForAssetClass(row.assetClass),
                            }}
                            size={14}
                            showMark={false}
                            showChips
                            style={{ maxWidth: dim(150) }}
                          />
                        </button>
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {formatNumber(row.quantity, 3)}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        {formatAccountPrice(row.mark, 2, maskValues)}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.unrealizedPnl), fontWeight: 400 }}>
                        {formatAccountMoney(row.unrealizedPnl, currency, false, maskValues)}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right", color: T.text }}>
                        {formatAccountMoney(row.marketValue, currency, false, maskValues)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {positions.length > 8 ? (
                <div style={{ color: T.textDim, fontSize: fs(8), marginTop: sp(3) }}>
                  Showing 8 of {formatNumber(positions.length, 0)} positions.
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: sp(4) }}>
              <div style={mutedLabelStyle}>DATE ACTIVITY</div>
              {activity.length ? (
                activity.slice(0, 7).map((row) => (
                  <div
                    key={row.id}
                    style={{
                      border: "none",
                      borderRadius: dim(RADII.xs),
                      background: T.bg0,
                      padding: sp("4px 5px"),
                      display: "grid",
                      gap: sp(3),
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: sp(5) }}>
                      <ActivityTone activity={row} />
                      <span style={{ color: T.textDim, fontFamily: T.data, fontSize: fs(8) }}>
                        {formatAppDateTime(row.timestamp)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: sp(5),
                        color: T.textSec,
                        fontFamily: T.data,
                        fontSize: fs(8),
                      }}
                    >
                      <span>{row.symbol || row.source}</span>
                      <span style={{ color: toneForValue(row.realizedPnl ?? row.amount), fontWeight: 400 }}>
                        {row.realizedPnl != null
                          ? formatAccountMoney(row.realizedPnl, currency, true, maskValues)
                          : formatAccountMoney(row.amount, currency, true, maskValues)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ color: T.textDim, fontSize: fs(9) }}>
                  No account activity is recorded for this date.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};

export const PositionsPanel = ({
  query,
  currency,
  assetFilter,
  onAssetFilterChange,
  sourceFilter = "all",
  onSourceFilterChange,
  onJumpToChart,
  rightRail = "IBKR positions + lots",
  emptyBody = "Positions from the IBKR account stream will appear here. Tax lots fill in from the local ledger as fills are observed.",
  maskValues = false,
  positionsAtDateQuery,
  activeEquityDate,
  pinnedEquityDate,
  currentPositionsCount,
  onClearEquityPin,
  isPhone = false,
}) => {
  const [sort, setSort] = useState({ id: "marketValue", dir: "desc" });
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const rows = useMemo(
    () =>
      (query.data?.positions || [])
        .filter(isOpenPositionRow)
        .filter((row) =>
          sourceFilter === "all" ? true : row.sourceType === sourceFilter,
        ),
    [query.data?.positions, sourceFilter],
  );
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sort.id];
      const bv = b[sort.id];
      const numericA = Number(av);
      const numericB = Number(bv);
      const result =
        Number.isFinite(numericA) && Number.isFinite(numericB)
          ? numericA - numericB
          : String(av ?? "").localeCompare(String(bv ?? ""));
      return sort.dir === "desc" ? -result : result;
    });
    return copy;
  }, [rows, sort]);
  const totalDayChange = useMemo(
    () =>
      rows.reduce(
        (sum, row) =>
          sum + (Number.isFinite(Number(row.dayChange)) ? Number(row.dayChange) : 0),
        0,
      ),
    [rows],
  );

  const toggleExpanded = useCallback((rowId) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const handleMobileRowAction = useCallback(
    (event) => {
      const { action, rowId, symbol } = event.currentTarget.dataset;
      if (!rowId) {
        return;
      }
      if (action === "chart") {
        event.stopPropagation();
        onJumpToChart?.(symbol);
        return;
      }
      if (action === "expand") {
        event.stopPropagation();
      }
      toggleExpanded(rowId);
    },
    [onJumpToChart, toggleExpanded],
  );

  const handleMobileRowKeyDown = useCallback(
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      handleMobileRowAction(event);
    },
    [handleMobileRowAction],
  );

  const inspectingDate = Boolean(activeEquityDate || pinnedEquityDate);
  const showInspector = inspectingDate && positionsAtDateQuery;

  const positionsTablePanel = (
    <Panel
      title={`Current Positions · ${rows.length}`}
      rightRail={rightRail}
      loading={query.isLoading}
      error={query.error}
      onRetry={query.refetch}
      minHeight={rows.length ? 144 : 174}
      noPad
      action={
        <div style={isPhone ? mobileFilterRailStyle : { display: "flex", gap: sp(4), flexWrap: "wrap" }}>
          <ToggleGroup options={ASSET_FILTERS} value={assetFilter} onChange={onAssetFilterChange} />
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
      {!rows.length ? (
        <div style={{ padding: sp(7) }}>
          <EmptyState
            title="No open positions"
            body={emptyBody}
          />
        </div>
      ) : isPhone ? (
        <div
          data-testid="account-positions-row-list"
          style={mobileRowListStyle}
        >
          <div aria-hidden="true" style={mobileHeaderStyle}>
            <span>Symbol</span>
            <span style={mobileHeaderEndStyle}>Qty/Mark</span>
            <span style={mobileHeaderEndStyle}>Day</span>
            <span style={mobileHeaderEndStyle}>P&L</span>
            <span style={mobileHeaderEndStyle}>Value</span>
            <span />
          </div>
          {sortedRows.map((row) => (
            <MobilePositionRow
              key={row.id}
              row={row}
              expanded={expandedRows.has(row.id)}
              currency={currency}
              maskValues={maskValues}
              onRowAction={handleMobileRowAction}
              onRowKeyDown={handleMobileRowKeyDown}
            />
          ))}
          <div
            data-testid="account-positions-summary-row"
            style={{
              ...mobileScanShellStyle(false),
              background: T.bg0,
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: sp(5),
              padding: sp("5px 6px"),
            }}
          >
            <MobileMetric label="Day" value={formatAccountMoney(totalDayChange, currency, true, maskValues)} tone={toneForValue(totalDayChange)} />
            <MobileMetric label="Net" value={formatAccountMoney(query.data?.totals?.netExposure, currency, true, maskValues)} />
            <MobileMetric
              label="Unreal"
              value={formatAccountMoney(query.data?.totals?.unrealizedPnl, currency, true, maskValues)}
              tone={toneForValue(query.data?.totals?.unrealizedPnl)}
            />
            <MobileMetric label="Weight" value={formatAccountPercent(query.data?.totals?.weightPercent, 2, maskValues)} />
          </div>
        </div>
      ) : (
        <div className="ra-hide-scrollbar" style={{ overflow: "auto", maxHeight: "34vh" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1160 }}>
            <thead>
              <tr style={tableHeaderStyle}>
                {[
                  ["symbol", "Symbol", "left"],
                  ["quantity", "Qty"],
                  ["averageCost", "Avg Cost"],
                  ["mark", "Mark"],
                  ["dayChangePercent", "Day %"],
                  ["dayChange", "Day $"],
                  ["unrealizedPnl", "Unreal P&L"],
                  ["unrealizedPnlPercent", "Unreal %"],
                  ["marketValue", "Mkt Value"],
                  ["weightPercent", "Weight"],
                  ["betaWeightedDelta", "β Δ"],
                ].map(([id, label, align]) => (
                  <th key={id} style={headerCellStyle(sort.id === id)}>
                    <SortButton
                      id={id}
                      label={label}
                      sort={sort}
                      setSort={setSort}
                      align={align === "left" ? "left" : "right"}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    tabIndex={0}
                    onKeyDown={moveTableFocus}
                    style={{
                      outline: "none",
                      cursor: "pointer",
                      background: expandedRows.has(row.id) ? `${T.bg3}aa` : "transparent",
                    }}
                    onClick={() => toggleExpanded(row.id)}
                  >
                    <td style={{ ...tableCellStyle, minWidth: 164 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: sp(6) }}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleExpanded(row.id);
                          }}
                          aria-expanded={expandedRows.has(row.id)}
                          style={{
                            width: 16,
                            height: 16,
                            border: "none",
                            borderRadius: dim(RADII.xs),
                            background: T.bg0,
                            color: T.textSec,
                            cursor: "pointer",
                            fontSize: fs(9),
                            fontWeight: 400,
                            flexShrink: 0,
                          }}
                        >
                          {expandedRows.has(row.id) ? "−" : "+"}
                        </button>
                        <div style={{ minWidth: 0 }}>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onJumpToChart?.(row.symbol);
                            }}
                            style={{
                              border: "none",
                              padding: 0,
                              background: "transparent",
                              color: T.text,
                              fontSize: fs(10),
                              fontWeight: 400,
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <MarketIdentityInline
                              item={{
                                ticker: row.symbol,
                                name: row.description || row.symbol,
                                market: marketForAssetClass(row.assetClass),
                                sector: row.sector || null,
                              }}
                              size={14}
                              showMark={false}
                              showChips
                              style={{ maxWidth: dim(148) }}
                            />
                          </button>
                          <div
                            style={{
                              marginTop: sp(1),
                              color: T.textDim,
                              fontSize: fs(8),
                              whiteSpace: "normal",
                              lineHeight: 1.25,
                            }}
                          >
                            {[
                              row.description || row.assetClass || "Position",
                              row.sector || null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: row.quantity < 0 ? T.red : T.text }}>
                      {formatNumber(row.quantity, 4)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      {formatAccountPrice(row.averageCost, 2, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: T.text }}>
                      {formatAccountPrice(row.mark, 2, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.dayChangePercent) }}>
                      {formatAccountPercent(row.dayChangePercent, 2, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.dayChange) }}>
                      {formatAccountMoney(row.dayChange, currency, false, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.unrealizedPnl), fontWeight: 400 }}>
                      {formatAccountMoney(row.unrealizedPnl, currency, false, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.unrealizedPnlPercent) }}>
                      {formatAccountPercent(row.unrealizedPnlPercent, 2, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: T.text }}>
                      {formatAccountMoney(row.marketValue, currency, false, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      {formatAccountPercent(row.weightPercent, 2, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      {formatNumber(row.betaWeightedDelta, 2)}
                    </td>
                  </tr>
                  {expandedRows.has(row.id) ? (
                    <tr>
                      <td
                        colSpan={11}
                        style={{
                          ...tableCellStyle,
                          padding: sp("6px 8px 7px 24px"),
                          whiteSpace: "normal",
                          background: `${T.bg2}cc`,
                        }}
                      >
                        <div style={{ display: "grid", gap: sp(6) }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
                            {(row.accounts || []).map((accountId) => (
                              <Pill key={`${row.id}:${accountId}`} tone="cyan">
                                {accountId}
                              </Pill>
                            ))}
                            {row.assetClass ? <Pill tone="purple">{row.assetClass}</Pill> : null}
                            {row.sourceType ? (
                              <Pill tone={sourceTone(row.sourceType)}>
                                {row.strategyLabel || row.sourceType}
                              </Pill>
                            ) : null}
                            {row.attributionStatus && row.attributionStatus !== "attributed" ? (
                              <Pill tone={row.attributionStatus === "mixed" ? "amber" : "default"}>
                                {row.attributionStatus}
                              </Pill>
                            ) : null}
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr) auto",
                              gap: sp(8),
                              alignItems: "start",
                            }}
                          >
                            <div>
                              <div style={{ ...mutedLabelStyle, marginBottom: sp(4) }}>Tax Lots</div>
                              {row.lots?.length ? (
                                <div className="ra-hide-scrollbar" style={{ overflow: "auto" }}>
                                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
                                    <thead>
                                      <tr>
                                        {lotColumns.map((label) => (
                                          <th
                                            key={label}
                                            style={{
                                              ...tableHeaderStyle,
                                              ...tableCellStyle,
                                            }}
                                          >
                                            {label}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.lots.slice(0, 6).map((lot, index) => (
                                        <tr key={`${row.id}:lot:${index}`}>
                                          <td style={tableCellStyle}>{lot.accountId}</td>
                                          <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                            {formatNumber(lot.quantity, 4)}
                                          </td>
                                          <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                            {formatAccountPrice(lot.averageCost, 2, maskValues)}
                                          </td>
                                          <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                            {formatAccountMoney(lot.marketValue, currency, false, maskValues)}
                                          </td>
                                          <td
                                            style={{
                                              ...tableCellStyle,
                                              textAlign: "right",
                                              color: toneForValue(lot.unrealizedPnl),
                                            }}
                                          >
                                            {formatAccountMoney(lot.unrealizedPnl, currency, false, maskValues)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div style={{ color: T.textMuted, fontSize: fs(10) }}>
                                  No tax-lot detail recorded yet.
                                </div>
                              )}
                            </div>

                            <div>
                              <div style={{ ...mutedLabelStyle, marginBottom: sp(4) }}>Source Attribution</div>
                              {row.sourceAttribution?.length ? (
                                <div style={{ display: "grid", gap: sp(3), marginBottom: sp(6) }}>
                                  {row.sourceAttribution.slice(0, 6).map((source, index) => (
                                    <div
                                      key={positionSourceAttributionKey(row.id, source, index)}
                                      style={{
                                        borderBottom: `1px solid ${T.border}`,
                                        padding: sp("3px 0"),
                                        display: "grid",
                                        gap: sp(3),
                                      }}
                                    >
                                      <div style={{ display: "flex", gap: sp(6), flexWrap: "wrap" }}>
                                        <Pill tone={sourceTone(source.sourceType)}>
                                          {source.strategyLabel || source.sourceType}
                                        </Pill>
                                        <Pill tone="cyan">
                                          Qty {formatNumber(source.quantity, 3)}
                                        </Pill>
                                      </div>
                                      <div
                                        style={{
                                          color: T.textDim,
                                          fontSize: fs(9),
                                          fontFamily: T.sans,
                                        }}
                                      >
                                        {source.deploymentName || source.candidateId || source.sourceEventId || "Manual ledger fill"}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                  <div style={{ color: T.textMuted, fontSize: fs(10), marginBottom: sp(8) }}>
                                  Source attribution is unavailable for this position.
                                </div>
                              )}
                              <div style={{ ...mutedLabelStyle, marginBottom: sp(4) }}>Open Orders</div>
                              {row.openOrders?.length ? (
                                <div style={{ display: "grid", gap: sp(3) }}>
                                  {row.openOrders.slice(0, 6).map((order, index) => (
                                    <div
                                      key={positionOpenOrderKey(row.id, order, index)}
                                      style={{
                                        borderBottom: `1px solid ${T.border}`,
                                        padding: sp("3px 0"),
                                        display: "grid",
                                        gap: sp(3),
                                      }}
                                    >
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
                                        <Pill tone={/buy/i.test(order.side) ? "side-buy" : "side-sell"}>
                                          {order.side}
                                        </Pill>
                                        <Pill tone="default">{order.type}</Pill>
                                        <Pill tone="accent">{order.status}</Pill>
                                      </div>
                                      <div
                                        style={{
                                          color: T.textSec,
                                          fontSize: fs(10),
                                          fontFamily: T.sans,
                                          lineHeight: 1.4,
                                        }}
                                      >
                                        {formatNumber(order.quantity, 2)} @{" "}
                                        {order.limitPrice != null
                                          ? formatAccountPrice(order.limitPrice, 2, maskValues)
                                          : order.stopPrice != null
                                            ? formatAccountPrice(order.stopPrice, 2, maskValues)
                                            : "Market"}
                                      </div>
                                      <div
                                        style={{
                                          color: T.textDim,
                                          fontSize: fs(9),
                                          fontFamily: T.sans,
                                        }}
                                      >
                                        {order.accountId}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ color: T.textMuted, fontSize: fs(10) }}>
                                  No working orders tied to this position.
                                </div>
                              )}
                            </div>

                            <div style={{ display: "grid", gap: sp(6), minWidth: dim(100) }}>
                              <button
                                type="button"
                                onClick={() => onJumpToChart?.(row.symbol)}
                                style={secondaryButtonStyle}
                              >
                                Chart
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr
                style={{
                  background: T.bg1,
                  position: "sticky",
                  bottom: 0,
                  zIndex: 1,
                }}
              >
                <td style={{ ...tableCellStyle, color: T.text, fontWeight: 400 }} colSpan={5}>
                  Totals
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(totalDayChange), fontWeight: 400 }}>
                  {formatAccountMoney(totalDayChange, currency, false, maskValues)}
                </td>
                <td
                  style={{
                    ...tableCellStyle,
                    textAlign: "right",
                    color: toneForValue(query.data?.totals?.unrealizedPnl),
                    fontWeight: 400,
                  }}
                >
                  {formatAccountMoney(query.data?.totals?.unrealizedPnl, currency, false, maskValues)}
                </td>
                <td />
                <td style={{ ...tableCellStyle, textAlign: "right", color: T.text, fontWeight: 400 }}>
                  {formatAccountMoney(query.data?.totals?.netExposure, currency, true, maskValues)}
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right", fontWeight: 400 }}>
                  {formatAccountPercent(query.data?.totals?.weightPercent, 2, maskValues)}
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right" }}>
                  Long {formatAccountMoney(query.data?.totals?.grossLong, currency, true, maskValues)} · Short{" "}
                  {formatAccountMoney(query.data?.totals?.grossShort, currency, true, maskValues)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );

  if (!showInspector) {
    return positionsTablePanel;
  }

  return (
    <div style={{ display: "grid", gap: sp(6) }}>
      <PositionsAtDateInspector
        query={positionsAtDateQuery}
        activeDate={activeEquityDate}
        pinnedDate={pinnedEquityDate}
        currentPositionsCount={currentPositionsCount}
        currency={currency}
        maskValues={maskValues}
        onClearPin={onClearEquityPin}
        onJumpToChart={onJumpToChart}
      />
      {positionsTablePanel}
    </div>
  );
};

export default PositionsPanel;
