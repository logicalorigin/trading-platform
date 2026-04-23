import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  EmptyState,
  Panel,
  Pill,
  formatMoney,
  moveTableFocus,
  mutedLabelStyle,
  tableCellStyle,
  tableHeaderStyle,
  toneForValue,
} from "./accountUtils";

const SummaryMetric = ({ label, value, tone = T.text, subvalue }) => (
  <div
    style={{
      padding: sp("4px 0"),
      display: "grid",
      gap: sp(3),
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div style={{ color: tone, fontSize: fs(15), fontFamily: T.mono, fontWeight: 900 }}>
      {value}
    </div>
    {subvalue ? (
      <div style={{ color: T.textDim, fontSize: fs(9), fontFamily: T.mono }}>{subvalue}</div>
    ) : null}
  </div>
);

const typeTone = (type) => {
  if (/dividend/i.test(type || "")) return "green";
  if (/interest/i.test(type || "")) return "cyan";
  if (/deposit/i.test(type || "")) return "accent";
  if (/withdrawal/i.test(type || "")) return "amber";
  if (/fee/i.test(type || "")) return "red";
  return "default";
};

export const CashFundingPanel = ({ query, currency }) => (
  <Panel
    title="Cash & Funding"
    subtitle="Cash balances, deposits, withdrawals, dividends, interest, and fees"
    rightRail="Flex cash activity + dividends"
    loading={query.isLoading}
    error={query.error}
    onRetry={query.refetch}
    minHeight={320}
  >
    {!query.data ? (
      <EmptyState
        title="Cash activity unavailable"
        body="Cash activity, dividends, and fees populate from Flex cash transactions and dividend rows."
      />
    ) : (
      <div style={{ display: "grid", gap: sp(10) }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: sp("6px 12px"),
            paddingBottom: sp(6),
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <SummaryMetric
            label="Settled Cash"
            value={formatMoney(query.data.settledCash, currency, true)}
            subvalue={`Unsettled ${formatMoney(query.data.unsettledCash, currency, true)}`}
          />
          <SummaryMetric
            label="Total Cash"
            value={formatMoney(query.data.totalCash, currency, true)}
          />
          <SummaryMetric
            label="Dividends YTD"
            value={formatMoney(query.data.dividendsYtd, currency, true)}
            tone={T.green}
            subvalue={`MTD ${formatMoney(query.data.dividendsMonth, currency, true)}`}
          />
          <SummaryMetric
            label="Interest YTD"
            value={formatMoney(query.data.interestPaidEarnedYtd, currency, true)}
            tone={toneForValue(query.data.interestPaidEarnedYtd)}
          />
          <SummaryMetric
            label="Fees YTD"
            value={formatMoney(query.data.feesYtd, currency, true)}
            tone={T.red}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.1fr) minmax(260px, 0.9fr)",
            gap: sp(12),
            alignItems: "start",
          }}
        >
          <div style={{ overflow: "auto", maxHeight: 280 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={tableHeaderStyle}>
                  {["Date", "Type", "Description", "Amount", "Source"].map((column) => (
                    <th key={column} style={{ ...tableCellStyle, ...tableHeaderStyle }}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(query.data.activities || []).map((activity) => (
                  <tr key={activity.id} tabIndex={0} onKeyDown={moveTableFocus}>
                    <td style={tableCellStyle}>{new Date(activity.date).toLocaleDateString()}</td>
                    <td style={tableCellStyle}>
                      <Pill tone={typeTone(activity.type)}>{activity.type}</Pill>
                    </td>
                    <td style={{ ...tableCellStyle, whiteSpace: "normal" }}>
                      {activity.description || "----"}
                    </td>
                    <td style={{ ...tableCellStyle, color: toneForValue(activity.amount), textAlign: "right" }}>
                      {formatMoney(activity.amount, activity.currency)}
                    </td>
                    <td style={tableCellStyle}>{activity.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: "grid",
              gap: sp(6),
              paddingLeft: sp(2),
              borderLeft: `1px solid ${T.border}`,
            }}
          >
            <div style={mutedLabelStyle}>Recent Dividends</div>
            {(query.data.dividends || []).length ? (
              (query.data.dividends || []).slice(0, 8).map((dividend) => (
                <div
                  key={dividend.id}
                  style={{
                    padding: sp("4px 0"),
                    borderBottom: `1px solid ${T.border}`,
                    display: "grid",
                    gap: sp(3),
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: sp(8) }}>
                    <div style={{ color: T.text, fontWeight: 900 }}>
                      {dividend.symbol || "Cash"}
                    </div>
                    <div style={{ color: T.green, fontWeight: 900 }}>
                      {formatMoney(dividend.amount, dividend.currency)}
                    </div>
                  </div>
                  <div style={{ color: T.textSec, fontSize: fs(10), lineHeight: 1.4 }}>
                    {dividend.description || "Dividend"}
                  </div>
                  <div style={{ color: T.textDim, fontSize: fs(9), fontFamily: T.mono }}>
                    {new Date(dividend.paidDate).toLocaleDateString()}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: T.textMuted, fontSize: fs(10) }}>No recent dividend rows.</div>
            )}
          </div>
        </div>
      </div>
    )}
  </Panel>
);

export default CashFundingPanel;
