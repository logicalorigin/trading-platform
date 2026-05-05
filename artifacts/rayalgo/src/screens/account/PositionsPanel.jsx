import { Fragment, useMemo, useState } from "react";
import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import { formatAppDateTime } from "../../lib/timeZone";
import {
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
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
import { isOpenPositionRow } from "../../features/account/accountPositionRows.js";
import { buildPositionsAtDateInspectorState } from "./positionsAtDateInspectorModel.js";

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
  { value: "watchlist_backtest", label: "Backtest" },
  { value: "mixed", label: "Mixed" },
];

const sourceTone = (sourceType) =>
  sourceType === "automation"
    ? "pink"
    : sourceType === "watchlist_backtest"
      ? "purple"
      : sourceType === "mixed"
        ? "amber"
        : "default";

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

const marketForAssetClass = (assetClass) =>
  String(assetClass || "").toLowerCase() === "etf" ? "etf" : "stocks";

const normalizeSymbolFilter = (value) => String(value || "").trim().toUpperCase();

const positionMatchesSymbol = (row, symbolFilter) => {
  const normalized = normalizeSymbolFilter(symbolFilter);
  if (!normalized) {
    return true;
  }
  return [row?.symbol, row?.optionContract?.underlying]
    .map(normalizeSymbolFilter)
    .filter(Boolean)
    .includes(normalized);
};

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
  const tone =
    activity?.type === "trade_buy"
      ? T.cyan
      : activity?.type === "trade_sell"
        ? toneForValue(activity.realizedPnl ?? activity.amount)
        : toneForValue(activity.amount);
  return (
    <Pill tone={tone === T.red ? "red" : tone === T.green ? "green" : "cyan"}>
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
          <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
            <Pill tone="cyan">
              {positions.length} positions
            </Pill>
            <Pill tone="purple">
              {activity.length} activity rows
            </Pill>
            {data?.snapshotDate ? (
              <Pill tone="default">
                as of {formatAppDateTime(data.snapshotDate)}
              </Pill>
            ) : null}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 0.8fr)",
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
                      <td style={{ ...tableCellStyle, color: T.text, fontWeight: 900 }}>
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
                        {formatAccountMoney(row.mark, currency, false, maskValues)}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.unrealizedPnl), fontWeight: 800 }}>
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
                      border: `1px solid ${T.border}`,
                      borderRadius: dim(4),
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
                      <span style={{ color: toneForValue(row.realizedPnl ?? row.amount), fontWeight: 900 }}>
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
  symbolFilter = "",
  onClearSymbolFilter,
  rightRail = "IBKR positions + lots",
  emptyBody = "Positions from the IBKR account stream will appear here. Tax lots fill in from the local ledger as fills are observed.",
  maskValues = false,
}) => {
  const [sort, setSort] = useState({ id: "marketValue", dir: "desc" });
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const normalizedSymbolFilter = normalizeSymbolFilter(symbolFilter);
  const rows = (query.data?.positions || [])
    .filter(isOpenPositionRow)
    .filter((row) => positionMatchesSymbol(row, normalizedSymbolFilter))
    .filter((row) =>
      sourceFilter === "all" ? true : row.sourceType === sourceFilter,
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
  const totalDayChange = rows.reduce(
    (sum, row) => sum + (Number.isFinite(Number(row.dayChange)) ? Number(row.dayChange) : 0),
    0,
  );

  const toggleExpanded = (rowId) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  return (
    <Panel
      title={`Current Positions · ${rows.length}`}
      rightRail={
        normalizedSymbolFilter ? `${rightRail} · ${normalizedSymbolFilter}` : rightRail
      }
      loading={query.isLoading}
      error={query.error}
      onRetry={query.refetch}
      minHeight={rows.length ? 144 : 174}
      noPad
      action={
        <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
          <ToggleGroup options={ASSET_FILTERS} value={assetFilter} onChange={onAssetFilterChange} />
          {onSourceFilterChange ? (
            <ToggleGroup
              options={SOURCE_FILTERS}
              value={sourceFilter}
              onChange={onSourceFilterChange}
            />
          ) : null}
          {normalizedSymbolFilter ? (
            <button
              type="button"
              data-testid="account-symbol-filter-clear"
              className="ra-interactive"
              onClick={onClearSymbolFilter}
              style={secondaryButtonStyle}
            >
              Clear {normalizedSymbolFilter}
            </button>
          ) : null}
        </div>
      }
    >
      {!rows.length ? (
        <div style={{ padding: sp(7) }}>
          <EmptyState
            title={
              normalizedSymbolFilter
                ? `No open ${normalizedSymbolFilter} positions`
                : "No open positions"
            }
            body={
              normalizedSymbolFilter
                ? "Risk drilldown is active; clear the symbol filter to return to all positions."
                : emptyBody
            }
          />
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
                            border: `1px solid ${T.border}`,
                            borderRadius: dim(4),
                            background: T.bg0,
                            color: T.textSec,
                            cursor: "pointer",
                            fontSize: fs(9),
                            fontWeight: 900,
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
                              fontWeight: 900,
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
                      {formatAccountMoney(row.averageCost, currency, false, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: T.text }}>
                      {formatAccountMoney(row.mark, currency, false, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.dayChangePercent) }}>
                      {formatAccountPercent(row.dayChangePercent, 2, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.dayChange) }}>
                      {formatAccountMoney(row.dayChange, currency, false, maskValues)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.unrealizedPnl), fontWeight: 800 }}>
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
                                            {formatAccountMoney(lot.averageCost, currency, false, maskValues)}
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
                                      key={`${row.id}:source:${source.candidateId || index}`}
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
                                          fontFamily: T.mono,
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
                                  {row.openOrders.slice(0, 6).map((order) => (
                                    <div
                                      key={order.id}
                                      style={{
                                        borderBottom: `1px solid ${T.border}`,
                                        padding: sp("3px 0"),
                                        display: "grid",
                                        gap: sp(3),
                                      }}
                                    >
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
                                        <Pill tone={/buy/i.test(order.side) ? "green" : "red"}>
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
                                          ? formatAccountMoney(order.limitPrice, currency, false, maskValues)
                                          : order.stopPrice != null
                                            ? formatAccountMoney(order.stopPrice, currency, false, maskValues)
                                            : "Market"}
                                      </div>
                                      <div
                                        style={{
                                          color: T.textDim,
                                          fontSize: fs(9),
                                          fontFamily: T.mono,
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
                <td style={{ ...tableCellStyle, color: T.text, fontWeight: 900 }} colSpan={5}>
                  Totals
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(totalDayChange), fontWeight: 800 }}>
                  {formatAccountMoney(totalDayChange, currency, false, maskValues)}
                </td>
                <td
                  style={{
                    ...tableCellStyle,
                    textAlign: "right",
                    color: toneForValue(query.data?.totals?.unrealizedPnl),
                    fontWeight: 800,
                  }}
                >
                  {formatAccountMoney(query.data?.totals?.unrealizedPnl, currency, false, maskValues)}
                </td>
                <td />
                <td style={{ ...tableCellStyle, textAlign: "right", color: T.text, fontWeight: 800 }}>
                  {formatAccountMoney(query.data?.totals?.netExposure, currency, true, maskValues)}
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right", fontWeight: 800 }}>
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
};

export default PositionsPanel;
