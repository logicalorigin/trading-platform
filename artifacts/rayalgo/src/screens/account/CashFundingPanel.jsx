import { T, fs, sp } from "../../RayAlgoPlatform";
import {
  EmptyState,
  Panel,
  formatMoney,
  mutedLabelStyle,
  tableCellStyle,
  tableHeaderStyle,
  toneForValue,
} from "./accountUtils";

const SummaryMetric = ({ label, value }) => (
  <div
    style={{
      padding: sp(10),
      border: `1px solid ${T.border}`,
      background: "rgba(15,23,42,0.45)",
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div style={{ marginTop: 4, color: T.text, fontSize: fs(13), fontWeight: 900 }}>
      {value}
    </div>
  </div>
);

export const CashFundingPanel = ({ query, currency }) => (
  <Panel
    title="Cash & Funding"
    subtitle="Cash balances, deposits, withdrawals, dividends, interest, fees"
    loading={query.isLoading}
    error={query.error}
    minHeight={300}
  >
    {!query.data ? (
      <EmptyState
        title="Cash activity unavailable"
        body="Cash activity, dividends, and fees populate from Flex cash transactions and dividend rows."
      />
    ) : (
      <div style={{ display: "grid", gap: sp(12) }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: sp(8) }}>
          <SummaryMetric label="Settled cash" value={formatMoney(query.data.settledCash, currency, true)} />
          <SummaryMetric label="Unsettled cash" value={formatMoney(query.data.unsettledCash, currency, true)} />
          <SummaryMetric label="Total cash" value={formatMoney(query.data.totalCash, currency, true)} />
          <SummaryMetric label="Dividends MTD" value={formatMoney(query.data.dividendsMonth, currency, true)} />
          <SummaryMetric label="Dividends YTD" value={formatMoney(query.data.dividendsYtd, currency, true)} />
          <SummaryMetric label="Fees YTD" value={formatMoney(query.data.feesYtd, currency, true)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: sp(12) }}>
          <div style={{ overflow: "auto", maxHeight: 240 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
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
                  <tr key={activity.id} tabIndex={0}>
                    <td style={tableCellStyle}>{new Date(activity.date).toLocaleDateString()}</td>
                    <td style={tableCellStyle}>{activity.type}</td>
                    <td style={tableCellStyle}>{activity.description || "----"}</td>
                    <td style={{ ...tableCellStyle, color: toneForValue(activity.amount) }}>
                      {formatMoney(activity.amount, activity.currency)}
                    </td>
                    <td style={tableCellStyle}>{activity.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "grid", gap: sp(8) }}>
            <div style={{ ...mutedLabelStyle, marginBottom: 2 }}>Recent dividends</div>
            {(query.data.dividends || []).slice(0, 8).map((dividend) => (
              <div
                key={dividend.id}
                style={{
                  border: `1px solid ${T.border}`,
                  padding: sp(8),
                  background: "rgba(15,23,42,0.45)",
                }}
              >
                <div style={{ color: T.text, fontWeight: 900 }}>
                  {dividend.symbol || "Cash"} · {formatMoney(dividend.amount, dividend.currency)}
                </div>
                <div style={{ color: T.textSec, fontSize: fs(10), marginTop: 3 }}>
                  {new Date(dividend.paidDate).toLocaleDateString()} · {dividend.description || "Dividend"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
  </Panel>
);

export default CashFundingPanel;
