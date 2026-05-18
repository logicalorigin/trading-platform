import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import {
  Pill,
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "../accountUtils";
import { arrayValue } from "./patternsCommon";

const AttributionTable = ({ title, rows, currency, maskValues }) => {
  const visibleRows = arrayValue(rows).filter((row) => row?.count);
  if (!visibleRows.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
      <div style={mutedLabelStyle}>{title}</div>
      <div className="ra-hide-scrollbar" style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: dim(560) }}>
          <thead>
            <tr
              style={{
                color: T.textMuted,
                fontFamily: T.sans,
                fontSize: textSize("tableHeader"),
                textTransform: "uppercase",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              {["Bucket", "P&L", "Trades", "Win", "Exp", "PF"].map((column) => (
                <th key={column} style={{ padding: sp("4px 5px"), textAlign: "left" }}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={`${row.kind}:${row.key}`} className="ra-table-row">
                <td
                  style={{
                    padding: sp("5px"),
                    color: T.text,
                    fontFamily: T.sans,
                    fontWeight: FONT_WEIGHTS.regular,
                    maxWidth: dim(190),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={row.label}
                >
                  {row.label}
                </td>
                <td style={{ padding: sp("5px"), color: toneForValue(row.realizedPnl), fontFamily: T.data }}>
                  {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
                </td>
                <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
                  {formatNumber(row.count || 0, 0)}
                </td>
                <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
                  {formatAccountPercent(row.winRatePercent, 0, maskValues)}
                </td>
                <td style={{ padding: sp("5px"), color: toneForValue(row.expectancy), fontFamily: T.data }}>
                  {formatAccountMoney(row.expectancy, currency, true, maskValues)}
                </td>
                <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
                  {row.profitFactor == null ? "-" : formatNumber(row.profitFactor, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TargetRows = ({ rows, currency, maskValues }) => {
  const visibleRows = arrayValue(rows);
  if (!visibleRows.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
      <div style={mutedLabelStyle}>NEXT SWEEP TARGETS</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(${dim(180)}px, 1fr))`,
          gap: sp(4),
        }}
      >
        {visibleRows.slice(0, 6).map((row) => (
          <div
            key={`${row.kind}:${row.key}`}
            style={{
              display: "grid",
              gap: sp(2),
              border: "none",
              borderRadius: dim(RADII.md),
              background: T.bg1,
              padding: sp("7px 9px"),
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: sp(4),
                alignItems: "baseline",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  color: T.text,
                  fontFamily: T.sans,
                  fontSize: textSize("control"),
                  fontWeight: FONT_WEIGHTS.regular,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={row.label}
              >
                {row.label}
              </span>
              <span style={{ color: toneForValue(row.realizedPnl), fontFamily: T.data }}>
                {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
              </span>
            </div>
            <div style={{ color: T.textDim, fontFamily: T.data, fontSize: textSize("label") }}>
              {formatNumber(row.count || 0, 0)} trades · exp{" "}
              {formatAccountMoney(row.expectancy, currency, true, maskValues)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const PatternsAttribution = ({ attribution, currency, maskValues }) => {
  const hasRows =
    arrayValue(attribution?.contributionRows).length ||
    arrayValue(attribution?.improvementTargets).length;
  if (!hasRows) return null;

  return (
    <div style={{ display: "grid", gap: sp(7), minWidth: 0 }}>
      <div style={{ display: "flex", gap: sp(4), flexWrap: "wrap" }}>
        <Pill tone="cyan">Attribution</Pill>
        <Pill tone="purple">Sweep Targets</Pill>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(${dim(260)}px, 1fr))`,
          gap: sp(7),
        }}
      >
        <AttributionTable
          title="LARGEST CONTRIBUTORS"
          rows={attribution.contributionRows}
          currency={currency}
          maskValues={maskValues}
        />
        <AttributionTable
          title="EXIT ATTRIBUTION"
          rows={attribution.exitRows}
          currency={currency}
          maskValues={maskValues}
        />
        <AttributionTable
          title="QUALITY / REGIME"
          rows={attribution.qualityRows}
          currency={currency}
          maskValues={maskValues}
        />
        <AttributionTable
          title="CONTRACT / PREMIUM"
          rows={attribution.contractRows}
          currency={currency}
          maskValues={maskValues}
        />
        <AttributionTable
          title="ENTRY TIMING"
          rows={attribution.timingRows}
          currency={currency}
          maskValues={maskValues}
        />
      </div>
      <TargetRows
        rows={attribution.improvementTargets}
        currency={currency}
        maskValues={maskValues}
      />
    </div>
  );
};

export default PatternsAttribution;
