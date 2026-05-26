import {
  useEffect,
  useState,
} from "react";
import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import { CSS_COLOR, FONT_WEIGHTS, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import { formatAppDate } from "../../lib/timeZone";
import { PaginationFooter, paginateRows } from "../../components/platform/TablePagination.jsx";
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

const CASH_ACTIVITY_PAGE_SIZE = 25;

const SummaryMetric = ({ label, value, tone = CSS_COLOR.text, subvalue }) => (
  <div
    style={{
      padding: sp("3px 0"),
      display: "grid",
      gap: sp(1),
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div style={{ color: tone, fontSize: textSize("bodyStrong"), fontFamily: T.sans, fontWeight: FONT_WEIGHTS.regular }}>
      {value}
    </div>
    {subvalue ? (
      <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("label"), fontFamily: T.sans }}>{subvalue}</div>
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

export const CashFundingPanel = ({ query, currency, maskValues = false }) => {
  const [page, setPage] = useState(0);
  const activities = query.data?.activities || [];
  const paginatedActivities = paginateRows(activities, page, CASH_ACTIVITY_PAGE_SIZE);

  useEffect(() => {
    if (paginatedActivities.safePage !== page) {
      setPage(paginatedActivities.safePage);
    }
  }, [page, paginatedActivities.safePage]);

  return (
    <Panel
      title="Cash & Funding"
      subtitle="Cash balances, deposits, withdrawals, dividends, interest, and fees"
      rightRail="Flex cash activity + dividends"
      loading={(query.isPending || query.isLoading) && !query.data}
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
            gridTemplateColumns: `repeat(auto-fit, minmax(${dim(120)}px, 1fr))`,
            gap: sp("3px 8px"),
            paddingBottom: sp(4),
            borderBottom: `1px solid ${CSS_COLOR.border}`,
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
            tone={CSS_COLOR.green}
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
            tone={CSS_COLOR.red}
          />
        </div>

        <div
          data-account-sidebar-grid
          style={{
            display: "grid",
            gridTemplateColumns: `minmax(0, 1.1fr) minmax(${dim(230)}px, 0.9fr)`,
            gap: sp(6),
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: sp(4), minWidth: 0 }}>
            <div
              data-testid="account-cash-activity-table-scroll"
              className="ra-hide-scrollbar"
              style={{ overflowX: "auto" }}
            >
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
                {paginatedActivities.pageRows.map((activity) => (
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
                      {activity.description || "—"}
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
            <PaginationFooter
              dataTestId="account-cash-activity-pagination"
              label="Rows"
              onPageChange={setPage}
              page={paginatedActivities.safePage}
              pageCount={paginatedActivities.pageCount}
              pageSize={CASH_ACTIVITY_PAGE_SIZE}
              total={paginatedActivities.total}
              style={{ paddingTop: sp(4), borderTop: `1px solid ${CSS_COLOR.border}` }}
            />
          </div>

          <div
            style={{
              display: "grid",
              gap: sp(5),
              paddingLeft: sp(2),
              borderLeft: `1px solid ${CSS_COLOR.border}`,
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
                    borderBottom: `1px solid ${CSS_COLOR.border}`,
                    display: "grid",
                    gap: sp(3),
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: sp(6) }}>
                    <div style={{ color: CSS_COLOR.text, fontWeight: FONT_WEIGHTS.regular, minWidth: 0 }}>
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
                    <div style={{ color: CSS_COLOR.green, fontWeight: FONT_WEIGHTS.regular }}>
                      {formatAccountMoney(dividend.amount, dividend.currency, false, maskValues)}
                    </div>
                  </div>
                  <div style={{ color: CSS_COLOR.textSec, fontSize: textSize("label"), lineHeight: 1.25 }}>
                    {dividend.description || "Dividend"}
                  </div>
                  <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("label"), fontFamily: T.sans }}>
                    {formatAppDate(dividend.paidDate)}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: CSS_COLOR.textMuted, fontSize: textSize("body") }}>No recent dividend rows.</div>
            )}
          </div>
        </div>
      </div>
      )}
    </Panel>
  );
};

export default CashFundingPanel;
