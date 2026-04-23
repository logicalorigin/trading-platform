import { Fragment, useMemo, useState } from "react";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  EmptyState,
  Panel,
  Pill,
  ToggleGroup,
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

const ASSET_FILTERS = [
  { value: "all", label: "All" },
  { value: "Stocks", label: "Stock" },
  { value: "ETF", label: "ETF" },
  { value: "Options", label: "Option" },
];

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

export const PositionsPanel = ({
  query,
  currency,
  assetFilter,
  onAssetFilterChange,
  onJumpToChart,
}) => {
  const [sort, setSort] = useState({ id: "marketValue", dir: "desc" });
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const rows = query.data?.positions || [];
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
      rightRail="IBKR positions + lots"
      loading={query.isLoading}
      error={query.error}
      onRetry={query.refetch}
      minHeight={440}
      noPad
      action={<ToggleGroup options={ASSET_FILTERS} value={assetFilter} onChange={onAssetFilterChange} />}
    >
      {!rows.length ? (
        <div style={{ padding: sp(12) }}>
          <EmptyState
            title="No open positions"
            body="Positions from the IBKR account stream will appear here. Tax lots fill in from the local ledger as fills are observed."
          />
        </div>
      ) : (
        <div style={{ overflow: "auto", maxHeight: "56vh" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1320 }}>
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
                    <td style={{ ...tableCellStyle, minWidth: 180 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: sp(8) }}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleExpanded(row.id);
                          }}
                          aria-expanded={expandedRows.has(row.id)}
                          style={{
                            width: 18,
                            height: 18,
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
                              fontSize: fs(11),
                              fontWeight: 900,
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            {row.symbol}
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
                      {formatMoney(row.averageCost, currency)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: T.text }}>
                      {formatMoney(row.mark, currency)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.dayChangePercent) }}>
                      {formatPercent(row.dayChangePercent)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.dayChange) }}>
                      {formatMoney(row.dayChange, currency)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.unrealizedPnl), fontWeight: 800 }}>
                      {formatMoney(row.unrealizedPnl, currency)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: toneForValue(row.unrealizedPnlPercent) }}>
                      {formatPercent(row.unrealizedPnlPercent)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right", color: T.text }}>
                      {formatMoney(row.marketValue, currency)}
                    </td>
                    <td style={{ ...tableCellStyle, textAlign: "right" }}>
                      {formatPercent(row.weightPercent)}
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
                          padding: sp("9px 12px 12px 32px"),
                          whiteSpace: "normal",
                          background: `${T.bg2}cc`,
                        }}
                      >
                        <div style={{ display: "grid", gap: sp(10) }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
                            {(row.accounts || []).map((accountId) => (
                              <Pill key={`${row.id}:${accountId}`} tone="cyan">
                                {accountId}
                              </Pill>
                            ))}
                            {row.assetClass ? <Pill tone="purple">{row.assetClass}</Pill> : null}
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr) auto",
                              gap: sp(12),
                              alignItems: "start",
                            }}
                          >
                            <div>
                              <div style={{ ...mutedLabelStyle, marginBottom: sp(6) }}>Tax Lots</div>
                              {row.lots?.length ? (
                                <div style={{ overflow: "auto" }}>
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
                                            {formatMoney(lot.averageCost, currency)}
                                          </td>
                                          <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                            {formatMoney(lot.marketValue, currency)}
                                          </td>
                                          <td
                                            style={{
                                              ...tableCellStyle,
                                              textAlign: "right",
                                              color: toneForValue(lot.unrealizedPnl),
                                            }}
                                          >
                                            {formatMoney(lot.unrealizedPnl, currency)}
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
                              <div style={{ ...mutedLabelStyle, marginBottom: sp(6) }}>Open Orders</div>
                              {row.openOrders?.length ? (
                                <div style={{ display: "grid", gap: sp(4) }}>
                                  {row.openOrders.slice(0, 6).map((order) => (
                                    <div
                                      key={order.id}
                                      style={{
                                        borderBottom: `1px solid ${T.border}`,
                                        padding: sp("4px 0"),
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
                                          ? formatMoney(order.limitPrice, currency)
                                          : order.stopPrice != null
                                            ? formatMoney(order.stopPrice, currency)
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

                            <div style={{ display: "grid", gap: sp(8), minWidth: dim(108) }}>
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
                  {formatMoney(totalDayChange, currency)}
                </td>
                <td
                  style={{
                    ...tableCellStyle,
                    textAlign: "right",
                    color: toneForValue(query.data?.totals?.unrealizedPnl),
                    fontWeight: 800,
                  }}
                >
                  {formatMoney(query.data?.totals?.unrealizedPnl, currency)}
                </td>
                <td />
                <td style={{ ...tableCellStyle, textAlign: "right", color: T.text, fontWeight: 800 }}>
                  {formatMoney(query.data?.totals?.netExposure, currency, true)}
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right", fontWeight: 800 }}>
                  {formatPercent(query.data?.totals?.weightPercent)}
                </td>
                <td style={{ ...tableCellStyle, textAlign: "right" }}>
                  Long {formatMoney(query.data?.totals?.grossLong, currency, true)} · Short{" "}
                  {formatMoney(query.data?.totals?.grossShort, currency, true)}
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
