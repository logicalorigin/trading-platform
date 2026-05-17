import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../../lib/uiTokens.jsx";
import {
  formatAccountMoney,
  formatAccountPercent,
  formatAccountSignedMoney,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "../accountUtils";
import { arrayValue } from "./patternsCommon";

const OutcomeBreakdownRows = ({ title, groups = [], currency, maskValues }) => {
  const rows = arrayValue(groups).filter((group) => group?.count).slice(0, 6);
  if (!rows.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
      <div style={mutedLabelStyle}>{title}</div>
      <div style={{ display: "grid", gap: sp(2) }}>
        {rows.map((row) => (
          <div
            key={`${title}:${row.kind}:${row.key}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto auto",
              gap: sp(5),
              alignItems: "center",
              border: "none",
              borderRadius: dim(RADII.md),
              background: T.bg1,
              padding: sp("5px 8px"),
              fontFamily: T.data,
              fontSize: textSize("label"),
            }}
          >
            <span style={{ color: T.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.label}
            </span>
            <span style={{ color: toneForValue(row.realizedPnl), fontWeight: FONT_WEIGHTS.regular }}>
              {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
            </span>
            <span style={{ color: T.textDim, textAlign: "right" }}>
              {formatNumber(row.count || 0, 0)} · {formatAccountPercent(row.winRatePercent, 0, maskValues)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const StopScenarioRows = ({ scenarios = [], currency, maskValues }) => {
  const rows = arrayValue(scenarios).slice(0, 5);
  if (!rows.length) return null;
  return (
    <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
      <div style={mutedLabelStyle}>STOP SCENARIO VARIANCE</div>
      <div className="ra-hide-scrollbar" style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: dim(520) }}>
          <thead>
            <tr
              style={{
                color: T.textMuted,
                fontFamily: T.data,
                fontSize: textSize("tableHeader"),
                textTransform: "uppercase",
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              {["Profile", "P&L", "Delta", "Std", "PF", "Win"].map((column) => (
                <th key={column} style={{ padding: sp("4px 5px"), textAlign: "left" }}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="ra-table-row">
                <td style={{ padding: sp("5px"), color: T.text, fontFamily: T.data, fontWeight: FONT_WEIGHTS.regular }}>
                  {row.label}
                </td>
                <td style={{ padding: sp("5px"), color: toneForValue(row.realizedPnl), fontFamily: T.data }}>
                  {formatAccountMoney(row.realizedPnl, currency, true, maskValues)}
                </td>
                <td style={{ padding: sp("5px"), color: toneForValue(row.deltaPnl), fontFamily: T.data }}>
                  {formatAccountSignedMoney(row.deltaPnl, currency, true, maskValues)}
                </td>
                <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
                  {formatAccountMoney(row.standardDeviation, currency, true, maskValues)}
                </td>
                <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
                  {row.profitFactor == null ? "—" : formatNumber(row.profitFactor, 2)}
                </td>
                <td style={{ padding: sp("5px"), color: T.textSec, fontFamily: T.data }}>
                  {formatAccountPercent(row.winRatePercent, 0, maskValues)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const PatternsByOutcomeDriver = ({
  contractBreakdowns,
  bucketGroups,
  stopScenarios,
  currency,
  maskValues,
}) => {
  const contractGroups = [
    ...arrayValue(contractBreakdowns?.optionRight),
    ...arrayValue(contractBreakdowns?.dte),
    ...arrayValue(contractBreakdowns?.strikeSlot),
  ];
  const outcomeGroups = [
    ...arrayValue(bucketGroups?.exitReason),
    ...arrayValue(bucketGroups?.entryTime),
    ...arrayValue(bucketGroups?.regime),
    ...arrayValue(bucketGroups?.mfeGiveback),
  ].sort((left, right) => Math.abs(right.realizedPnl || 0) - Math.abs(left.realizedPnl || 0));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${dim(260)}px), 1fr))`,
        gap: sp(7),
        minWidth: 0,
      }}
    >
      <OutcomeBreakdownRows
        title="CONTRACT SELECTION"
        groups={contractGroups}
        currency={currency}
        maskValues={maskValues}
      />
      <OutcomeBreakdownRows
        title="OUTCOME DRIVERS"
        groups={outcomeGroups}
        currency={currency}
        maskValues={maskValues}
      />
      <StopScenarioRows
        scenarios={stopScenarios}
        currency={currency}
        maskValues={maskValues}
      />
    </div>
  );
};

export default PatternsByOutcomeDriver;
