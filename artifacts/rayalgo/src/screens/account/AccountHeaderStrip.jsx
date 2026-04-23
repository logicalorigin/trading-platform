import { T, dim, fs, sp } from "../../RayAlgoPlatform";
import {
  formatMoney,
  formatPercent,
  formatSignedMoney,
  metricTitle,
  mutedLabelStyle,
  toneForValue,
} from "./accountUtils";

const metricValue = (metric, currency, kind = "money") => {
  if (!metric) return "----";
  if (kind === "percent") return formatPercent(metric.value);
  if (kind === "signedMoney") return formatSignedMoney(metric.value, currency, true);
  return formatMoney(metric.value, metric.currency || currency, true);
};

const HeaderMetric = ({ label, metric, currency, kind }) => (
  <div
    title={metricTitle(metric)}
    style={{
      minWidth: dim(112),
      padding: sp("8px 10px"),
      border: `1px solid ${T.border}`,
      background: "rgba(15,23,42,0.72)",
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div
      style={{
        marginTop: 4,
        color:
          kind === "signedMoney" || kind === "percent"
            ? toneForValue(metric?.value)
            : T.text,
        fontSize: fs(14),
        fontFamily: T.sans,
        fontWeight: 900,
      }}
    >
      {metricValue(metric, currency, kind)}
    </div>
  </div>
);

export const AccountHeaderStrip = ({
  accounts = [],
  accountId,
  onAccountIdChange,
  summary,
  loading,
}) => {
  const metrics = summary?.metrics || {};
  const currency = summary?.currency || accounts[0]?.currency || "USD";
  const pdt = summary?.badges?.pdt;
  const pdtRemaining =
    pdt?.dayTradesRemainingThisWeek === Infinity
      ? null
      : pdt?.dayTradesRemainingThisWeek;

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(260px, 1.2fr) repeat(7, minmax(104px, auto))",
        gap: sp(8),
        alignItems: "stretch",
        overflowX: "auto",
      }}
    >
      <div
        style={{
          padding: sp(10),
          border: `1px solid ${T.border}`,
          background:
            "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(8,47,73,0.65))",
          minWidth: dim(260),
        }}
      >
        <div style={mutedLabelStyle}>Account view</div>
        <select
          value={accountId}
          onChange={(event) => onAccountIdChange(event.target.value)}
          style={{
            width: "100%",
            marginTop: sp(6),
            background: T.bg0,
            border: `1px solid ${T.border}`,
            color: T.text,
            height: dim(30),
            fontSize: fs(12),
            fontFamily: T.sans,
            fontWeight: 800,
            padding: sp("0 8px"),
            outline: "none",
          }}
        >
          <option value="combined">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.displayName || account.id}
            </option>
          ))}
        </select>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: sp(6),
            marginTop: sp(8),
          }}
        >
          {(summary?.accounts || accounts).map((account) => (
            <span
              key={account.id}
              title={account.updatedAt ? `Updated ${new Date(account.updatedAt).toLocaleString()}` : account.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                color: T.textSec,
                fontSize: fs(9),
                fontFamily: T.mono,
                border: `1px solid ${T.border}`,
                padding: sp("3px 6px"),
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: account.live === false ? T.textMuted : T.green,
                  boxShadow:
                    account.live === false
                      ? "none"
                      : `0 0 10px ${T.green}`,
                }}
              />
              {account.id}
            </span>
          ))}
          {(summary?.badges?.accountTypes || []).map((badge) => (
            <span
              key={badge}
              style={{
                color: T.accent,
                fontSize: fs(9),
                fontFamily: T.sans,
                fontWeight: 800,
                border: `1px solid ${T.accent}55`,
                padding: sp("3px 6px"),
              }}
            >
              {badge}
            </span>
          ))}
          <span
            style={{
              color: pdt?.isPatternDayTrader ? T.orange : T.textMuted,
              fontSize: fs(9),
              fontFamily: T.sans,
              fontWeight: 800,
              border: `1px solid ${pdt?.isPatternDayTrader ? T.orange : T.border}`,
              padding: sp("3px 6px"),
            }}
          >
            PDT {pdt?.isPatternDayTrader ? "YES" : "NO"}{" "}
            {pdtRemaining != null ? `· ${pdtRemaining} left` : ""}
          </span>
        </div>
      </div>

      <HeaderMetric label="Net Liq" metric={metrics.netLiquidation} currency={currency} />
      <HeaderMetric label="Cash" metric={metrics.totalCash} currency={currency} />
      <HeaderMetric label="Buying Power" metric={metrics.buyingPower} currency={currency} />
      <HeaderMetric label="Margin Used" metric={metrics.marginUsed} currency={currency} />
      <HeaderMetric
        label="Maint Cushion"
        metric={metrics.maintenanceMarginCushionPercent}
        currency={currency}
        kind="percent"
      />
      <HeaderMetric
        label="Day P&L"
        metric={metrics.dayPnl}
        currency={currency}
        kind="signedMoney"
      />
      <HeaderMetric
        label="Total P&L"
        metric={metrics.totalPnl}
        currency={currency}
        kind="signedMoney"
      />
      {loading ? null : null}
    </section>
  );
};

export default AccountHeaderStrip;
