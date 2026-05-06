import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import { formatAppDate } from "../../lib/timeZone";
import {
  EmptyState,
  Panel,
  Pill,
  formatAccountMoney,
  moveTableFocus,
  mutedLabelStyle,
  tableCellStyle,
  tableHeaderStyle,
  toneForValue,
} from "./accountUtils";

const SummaryMetric = ({ label, value, tone = T.text, subvalue }) => (
  <div
    style={{
      padding: sp("3px 0"),
      display: "grid",
      gap: sp(1),
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div style={{ color: tone, fontSize: fs(11), fontFamily: T.mono, fontWeight: 400 }}>
      {value}
    </div>
    {subvalue ? (
      <div style={{ color: T.textDim, fontSize: fs(8), fontFamily: T.mono }}>{subvalue}</div>
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

const sourceTone = (sourceType) =>
  sourceType === "automation"
    ? "pink"
    : sourceType === "watchlist_backtest"
      ? "purple"
      : "default";

export const CashFundingPanel = ({ query, currency, maskValues = false }) => (
  <Panel
    title="Cash & Funding"
    subtitle="Cash balances, deposits, withdrawals, dividends, interest, and fees"
    rightRail="Flex cash activity + dividends"
    loading={query.isLoading}
    error={query.error}
    onRetry={query.refetch}
    minHeight={168}
  >
    {!query.data ? (
      <EmptyState
        title="Cash activity unavailable"
        body="Cash activity, dividends, and fees populate from Flex cash transactions and dividend rows."
      />
    ) : (
      <div style={{ display: "grid", gap: sp(5) }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: sp("3px 8px"),
            paddingBottom: sp(4),
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <SummaryMetric
            label="Settled Cash"
            value={formatAccountMoney(query.data.settledCash, currency, true, maskValues)}
            subvalue={`Unsettled ${formatAccountMoney(query.data.unsettledCash, currency, true, maskValues)}`}
          />
          <SummaryMetric
            label="Total Cash"
            value={formatAccountMoney(query.data.totalCash, currency, true, maskValues)}
          />
          <SummaryMetric
            label="Dividends YTD"
            value={formatAccountMoney(query.data.dividendsYtd, currency, true, maskValues)}
            tone={T.green}
            subvalue={`MTD ${formatAccountMoney(query.data.dividendsMonth, currency, true, maskValues)}`}
          />
          <SummaryMetric
            label="Interest YTD"
            value={formatAccountMoney(query.data.interestPaidEarnedYtd, currency, true, maskValues)}
            tone={toneForValue(query.data.interestPaidEarnedYtd)}
          />
          <SummaryMetric
            label="Fees YTD"
            value={formatAccountMoney(query.data.feesYtd, currency, true, maskValues)}
            tone={T.red}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.1fr) minmax(230px, 0.9fr)",
            gap: sp(6),
            alignItems: "start",
          }}
        >
          <div className="ra-hide-scrollbar" style={{ overflow: "auto", maxHeight: 170 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 650 }}>
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
                  <tr
                    key={activity.id}
                    className="ra-table-row"
                    tabIndex={0}
                    onKeyDown={moveTableFocus}
                  >
                    <td style={tableCellStyle}>{formatAppDate(activity.date)}</td>
                    <td style={tableCellStyle}>
                      <Pill tone={typeTone(activity.type)}>{activity.type}</Pill>
                    </td>
                    <td style={{ ...tableCellStyle, whiteSpace: "normal" }}>
                      {activity.description || "----"}
                    </td>
                    <td style={{ ...tableCellStyle, color: toneForValue(activity.amount), textAlign: "right" }}>
                      {formatAccountMoney(activity.amount, activity.currency, false, maskValues)}
                    </td>
                    <td style={tableCellStyle}>
                      {activity.sourceType ? (
                        <Pill tone={sourceTone(activity.sourceType)}>
                          {activity.strategyLabel || activity.sourceType}
                        </Pill>
                      ) : (
                        activity.source
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: "grid",
              gap: sp(5),
              paddingLeft: sp(2),
              borderLeft: `1px solid ${T.border}`,
            }}
          >
            <div style={mutedLabelStyle}>Recent Dividends</div>
            {(query.data.dividends || []).length ? (
              (query.data.dividends || []).slice(0, 5).map((dividend) => (
                <div
                  key={dividend.id}
                  className="ra-row-enter"
                  style={{
                    padding: sp("2px 0"),
                    borderBottom: `1px solid ${T.border}`,
                    display: "grid",
                    gap: sp(3),
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: sp(6) }}>
                    <div style={{ color: T.text, fontWeight: 400, minWidth: 0 }}>
                      {dividend.symbol ? (
                        <MarketIdentityInline
                          item={{
                            ticker: dividend.symbol,
                            name: dividend.description || dividend.symbol,
                            market: "stocks",
                          }}
                          size={14}
                          showMark={false}
                          showChips
                          style={{ maxWidth: dim(112) }}
                        />
                      ) : (
                        "Cash"
                      )}
                    </div>
                    <div style={{ color: T.green, fontWeight: 400 }}>
                      {formatAccountMoney(dividend.amount, dividend.currency, false, maskValues)}
                    </div>
                  </div>
                  <div style={{ color: T.textSec, fontSize: fs(8), lineHeight: 1.25 }}>
                    {dividend.description || "Dividend"}
                  </div>
                  <div style={{ color: T.textDim, fontSize: fs(8), fontFamily: T.mono }}>
                    {formatAppDate(dividend.paidDate)}
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
