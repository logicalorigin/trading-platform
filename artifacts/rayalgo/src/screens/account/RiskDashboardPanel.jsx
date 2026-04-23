import { T, dim, fs, sp } from "../../RayAlgoPlatform";
import {
  EmptyState,
  Panel,
  formatMoney,
  formatNumber,
  formatPercent,
  mutedLabelStyle,
  sectionTitleStyle,
  toneForValue,
} from "./accountUtils";

const MiniList = ({ title, rows = [], currency, valueKey = "marketValue" }) => (
  <div>
    <div style={{ ...sectionTitleStyle, fontSize: fs(10), marginBottom: sp(8) }}>
      {title}
    </div>
    <div style={{ display: "grid", gap: sp(5) }}>
      {rows.length ? (
        rows.map((row) => (
          <div
            key={`${title}:${row.symbol || row.sector}`}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              gap: sp(8),
              color: T.textSec,
              fontSize: fs(10),
              fontFamily: T.sans,
            }}
          >
            <span style={{ color: T.text }}>{row.symbol || row.sector}</span>
            <span style={{ color: toneForValue(row[valueKey]) }}>
              {formatMoney(row[valueKey], currency, true)}
            </span>
            <span>{formatPercent(row.weightPercent)}</span>
          </div>
        ))
      ) : (
        <div style={{ color: T.textMuted, fontSize: fs(10) }}>No rows</div>
      )}
    </div>
  </div>
);

const Gauge = ({ label, value, max = 100 }) => {
  const pct =
    value == null || Number.isNaN(Number(value))
      ? 0
      : Math.max(0, Math.min(100, (Number(value) / max) * 100));
  return (
    <div>
      <div style={mutedLabelStyle}>{label}</div>
      <div
        style={{
          height: dim(10),
          marginTop: sp(6),
          background: T.bg0,
          border: `1px solid ${T.border}`,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: pct > 75 ? T.red : pct > 45 ? T.orange : T.green,
          }}
        />
      </div>
      <div style={{ marginTop: 4, color: T.text, fontSize: fs(11), fontWeight: 800 }}>
        {value == null ? "----" : formatPercent(value)}
      </div>
    </div>
  );
};

export const RiskDashboardPanel = ({ query, currency }) => {
  const data = query.data;
  const margin = data?.margin || {};
  const greeks = data?.greeks || {};
  const perUnderlying = greeks.perUnderlying || [];

  return (
    <Panel
      title="Risk Dashboard"
      subtitle="Concentration, margin, leverage, and IBKR-derived portfolio Greeks"
      loading={query.isLoading}
      error={query.error}
      minHeight={420}
    >
      {!data ? (
        <EmptyState title="Risk unavailable" body="Risk metrics load after account and position streams are connected." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: sp(16) }}>
          <div style={{ display: "grid", gap: sp(14) }}>
            <MiniList
              title="Top Concentration"
              rows={data.concentration?.topPositions || []}
              currency={currency}
            />
            <MiniList
              title="Sector Concentration"
              rows={data.concentration?.sectors || []}
              currency={currency}
              valueKey="value"
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(12) }}>
              <MiniList
                title="Biggest Winners"
                rows={data.winnersLosers?.allTimeWinners || []}
                currency={currency}
                valueKey="unrealizedPnl"
              />
              <MiniList
                title="Biggest Losers"
                rows={data.winnersLosers?.allTimeLosers || []}
                currency={currency}
                valueKey="unrealizedPnl"
              />
            </div>
          </div>
          <div style={{ display: "grid", gap: sp(14) }}>
            <div
              title="IBKR fields: InitMarginReq, ExcessLiquidity, MaintMarginReq, Cushion"
              style={{
                border: `1px solid ${T.border}`,
                padding: sp(12),
                background: "rgba(15,23,42,0.45)",
              }}
            >
              <div style={{ ...sectionTitleStyle, fontSize: fs(10) }}>
                Portfolio Margin
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: sp(10), marginTop: sp(10) }}>
                <Gauge label="Maintenance cushion" value={margin.maintenanceCushionPercent} />
                <Gauge label="Leverage ratio" value={(margin.leverageRatio || 0) * 100} max={300} />
                <Metric label="Margin used" value={formatMoney(margin.marginUsed, currency, true)} />
                <Metric label="Available" value={formatMoney(margin.marginAvailable, currency, true)} />
                <Metric label="DT buying power" value={formatMoney(margin.dayTradingBuyingPower, currency, true)} />
                <Metric label="SMA" value={formatMoney(margin.sma, currency, true)} />
              </div>
            </div>
            <div
              title={greeks.warning || "IBKR position/quote-derived Greeks"}
              style={{
                border: `1px solid ${T.border}`,
                padding: sp(12),
                background: "rgba(15,23,42,0.45)",
              }}
            >
              <div style={{ ...sectionTitleStyle, fontSize: fs(10) }}>
                Portfolio Greeks
              </div>
              {greeks.warning ? (
                <div
                  style={{
                    marginTop: sp(8),
                    color: T.textMuted,
                    fontSize: fs(10),
                    lineHeight: 1.45,
                  }}
                >
                  {greeks.warning}
                </div>
              ) : null}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: sp(8), marginTop: sp(10) }}>
                <Metric label="Δ raw" value={formatNumber(greeks.delta, 2)} />
                <Metric label="β Δ SPY" value={formatNumber(greeks.betaWeightedDelta, 2)} />
                <Metric label="Γ" value={formatNumber(greeks.gamma, 4)} />
                <Metric label="Θ/day" value={formatNumber(greeks.theta, 2)} />
                <Metric label="Vega" value={formatNumber(greeks.vega, 2)} />
                <Metric label="Rho" value={greeks.rho ?? "----"} />
              </div>
              <div style={{ marginTop: sp(12) }}>
                <div style={{ ...sectionTitleStyle, fontSize: fs(10), marginBottom: sp(8) }}>
                  Per Underlying
                </div>
                {perUnderlying.length ? (
                  <div style={{ overflow: "auto", maxHeight: "22vh" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                      <thead>
                        <tr>
                          {["Underlying", "Exposure", "Δ", "β Δ", "Γ", "Θ", "Vega"].map((label) => (
                            <th
                              key={label}
                              style={{
                                ...sectionTitleStyle,
                                fontSize: fs(9),
                                textAlign: "left",
                                paddingBottom: sp(6),
                              }}
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {perUnderlying.slice(0, 8).map((row) => (
                          <tr key={row.underlying}>
                            <td style={{ padding: sp("5px 0"), color: T.text, fontSize: fs(10), fontWeight: 800 }}>
                              {row.underlying}
                            </td>
                            <td style={{ padding: sp("5px 0"), color: T.textSec, fontSize: fs(10) }}>
                              {formatMoney(row.exposure, currency, true)}
                            </td>
                            <td style={{ padding: sp("5px 0"), color: T.textSec, fontSize: fs(10) }}>
                              {formatNumber(row.delta, 2)}
                            </td>
                            <td style={{ padding: sp("5px 0"), color: T.textSec, fontSize: fs(10) }}>
                              {formatNumber(row.betaWeightedDelta, 2)}
                            </td>
                            <td style={{ padding: sp("5px 0"), color: T.textSec, fontSize: fs(10) }}>
                              {formatNumber(row.gamma, 4)}
                            </td>
                            <td style={{ padding: sp("5px 0"), color: T.textSec, fontSize: fs(10) }}>
                              {formatNumber(row.theta, 2)}
                            </td>
                            <td style={{ padding: sp("5px 0"), color: T.textSec, fontSize: fs(10) }}>
                              {formatNumber(row.vega, 2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ color: T.textMuted, fontSize: fs(10) }}>
                    No underlying Greek breakdown available.
                  </div>
                )}
              </div>
            </div>
            <div>
              <div style={{ ...sectionTitleStyle, fontSize: fs(10), marginBottom: sp(8) }}>
                Expiry Notional
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: sp(6) }}>
                {[
                  ["This week", data.expiryConcentration?.thisWeek],
                  ["This month", data.expiryConcentration?.thisMonth],
                  ["Next 90d", data.expiryConcentration?.next90Days],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      padding: sp(8),
                      minHeight: dim(48),
                      background: "linear-gradient(135deg, rgba(249,115,22,0.22), rgba(30,41,59,0.55))",
                      border: `1px solid ${T.border}`,
                    }}
                  >
                    <div style={mutedLabelStyle}>{label}</div>
                    <div style={{ color: T.text, fontWeight: 900, marginTop: 4 }}>
                      {formatMoney(value, currency, true)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};

const Metric = ({ label, value }) => (
  <div
    style={{
      padding: sp(8),
      minHeight: dim(46),
      border: `1px solid ${T.border}`,
      background: T.bg0,
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div style={{ color: T.text, fontSize: fs(12), fontWeight: 900, marginTop: 4 }}>
      {value}
    </div>
  </div>
);

export default RiskDashboardPanel;
