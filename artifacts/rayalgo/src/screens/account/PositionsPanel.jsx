import { useMemo, useState } from "react";
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

const ASSET_FILTERS = ["all", "Stocks", "ETF", "Options", "Cash"];

const SortButton = ({ id, label, sort, setSort }) => (
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
      color: T.textMuted,
      font: "inherit",
      cursor: "pointer",
      textTransform: "inherit",
      letterSpacing: "inherit",
    }}
  >
    {label} {sort.id === id ? (sort.dir === "desc" ? "↓" : "↑") : ""}
  </button>
);

const moveFocus = (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const row = event.currentTarget;
  const next =
    event.key === "ArrowDown"
      ? row.nextElementSibling
      : row.previousElementSibling;
  if (next?.focus) {
    event.preventDefault();
    next.focus();
  }
};

export const PositionsPanel = ({
  query,
  currency,
  assetFilter,
  onAssetFilterChange,
  onJumpToChart,
}) => {
  const [sort, setSort] = useState({ id: "marketValue", dir: "desc" });
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

  return (
    <Panel
      title="Current Positions"
      subtitle="Live IBKR positions with tax lots and working order context"
      loading={query.isLoading}
      error={query.error}
      minHeight={380}
      action={
        <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
          {ASSET_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => onAssetFilterChange(filter)}
              style={denseButtonStyle(assetFilter === filter)}
            >
              {filter === "all" ? "All" : filter}
            </button>
          ))}
        </div>
      }
    >
      {!rows.length ? (
        <EmptyState
          title="No open positions"
          body="Positions from the IBKR account stream will appear here. Tax lots fill in from the local ledger as fills are observed."
        />
      ) : (
        <div style={{ overflow: "auto", maxHeight: "52vh" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 1260,
            }}
          >
            <thead>
              <tr style={tableHeaderStyle}>
                {[
                  ["symbol", "Symbol"],
                  ["description", "Description"],
                  ["quantity", "Qty"],
                  ["averageCost", "Avg Cost"],
                  ["mark", "Mark"],
                  ["dayChange", "Day Δ"],
                  ["unrealizedPnl", "Unreal P&L"],
                  ["marketValue", "Market Value"],
                  ["weightPercent", "Weight"],
                  ["betaWeightedDelta", "β Δ"],
                  ["sector", "Sector"],
                ].map(([id, label]) => (
                  <th key={id} style={{ ...tableCellStyle, ...tableHeaderStyle }}>
                    <SortButton id={id} label={label} sort={sort} setSort={setSort} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  onKeyDown={moveFocus}
                  style={{ outline: "none" }}
                >
                  <td style={{ ...tableCellStyle, color: T.text, fontWeight: 900 }}>
                    <button
                      type="button"
                      onClick={() => onJumpToChart?.(row.symbol)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: T.accent,
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      {row.symbol}
                    </button>
                  </td>
                  <td style={tableCellStyle}>{row.description}</td>
                  <td style={tableCellStyle}>{formatNumber(row.quantity, 4)}</td>
                  <td style={tableCellStyle}>{formatMoney(row.averageCost, currency)}</td>
                  <td style={tableCellStyle}>{formatMoney(row.mark, currency)}</td>
                  <td style={{ ...tableCellStyle, color: toneForValue(row.dayChange) }}>
                    {row.dayChange == null
                      ? "----"
                      : `${formatMoney(row.dayChange, currency)} / ${formatPercent(row.dayChangePercent)}`}
                  </td>
                  <td style={{ ...tableCellStyle, color: toneForValue(row.unrealizedPnl) }}>
                    {formatMoney(row.unrealizedPnl, currency)} /{" "}
                    {formatPercent(row.unrealizedPnlPercent)}
                  </td>
                  <td style={tableCellStyle}>{formatMoney(row.marketValue, currency)}</td>
                  <td style={tableCellStyle}>{formatPercent(row.weightPercent)}</td>
                  <td style={tableCellStyle}>
                    {row.betaWeightedDelta == null
                      ? "----"
                      : formatNumber(row.betaWeightedDelta, 2)}
                  </td>
                  <td style={tableCellStyle}>{row.sector}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: T.bg0 }}>
                <td style={{ ...tableCellStyle, color: T.text, fontWeight: 900 }} colSpan={6}>
                  Totals
                </td>
                <td style={{ ...tableCellStyle, color: toneForValue(query.data?.totals?.unrealizedPnl) }}>
                  {formatMoney(query.data?.totals?.unrealizedPnl, currency)}
                </td>
                <td style={tableCellStyle}>
                  Net {formatMoney(query.data?.totals?.netExposure, currency, true)}
                </td>
                <td style={tableCellStyle}>
                  {formatPercent(query.data?.totals?.weightPercent)}
                </td>
                <td style={tableCellStyle} colSpan={2}>
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
