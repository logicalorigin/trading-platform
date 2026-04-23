import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  EmptyState,
  Panel,
  Pill,
  formatMoney,
  formatNumber,
  formatPercent,
  mutedLabelStyle,
  sectionTitleStyle,
  tableCellStyle,
  tableHeaderStyle,
  toneForValue,
} from "./accountUtils";

const ratioPercent = (value) =>
  value == null || Number.isNaN(Number(value))
    ? "----"
    : formatPercent(Number(value) * 100, 1);

const MetricCard = ({ label, value, title, tone = T.text, subvalue }) => (
  <div
    title={title}
    style={{
      padding: sp("4px 0"),
      display: "grid",
      gap: sp(3),
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div style={{ color: tone, fontSize: fs(13), fontFamily: T.mono, fontWeight: 900 }}>
      {value}
    </div>
    {subvalue ? (
      <div style={{ color: T.textDim, fontSize: fs(9), fontFamily: T.mono }}>{subvalue}</div>
    ) : null}
  </div>
);

const MarginGauge = ({ value }) => {
  const ratio = Number(value);
  const pct = Number.isFinite(ratio) ? Math.max(0, Math.min(100, ratio * 100)) : 0;
  const tone = pct > 50 ? T.green : pct > 25 ? T.amber : T.red;
  return (
    <div
      style={{
        padding: sp("4px 0"),
        display: "grid",
        gap: sp(8),
      }}
    >
      <div style={mutedLabelStyle}>Maintenance Cushion</div>
      <div
        style={{
          color: tone,
          fontSize: fs(20),
          fontFamily: T.mono,
          fontWeight: 900,
          letterSpacing: "-0.02em",
        }}
      >
        {ratioPercent(value)}
      </div>
      <div
        style={{
          height: dim(14),
          borderRadius: dim(5),
          overflow: "hidden",
          background: T.bg3,
          border: `1px solid ${T.border}`,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: tone,
          }}
        />
      </div>
      <div style={{ color: T.textDim, fontSize: fs(9), fontFamily: T.mono }}>
        IBKR Cushion
      </div>
    </div>
  );
};

const RankedList = ({ title, rows = [], currency, valueKey, emptyLabel = "No rows" }) => (
  <div
    style={{
      display: "grid",
      gap: sp(6),
    }}
  >
    <div style={{ ...sectionTitleStyle, fontSize: fs(9) }}>{title}</div>
    {rows.length ? (
      rows.map((row) => (
        <div
          key={`${title}:${row.symbol || row.sector}`}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: sp(8),
            alignItems: "center",
            padding: sp("4px 0"),
            borderBottom: `1px solid ${T.border}`,
            fontSize: fs(10),
            fontFamily: T.sans,
          }}
        >
          <span style={{ color: T.text, minWidth: 0 }}>{row.symbol || row.sector}</span>
          <span style={{ color: toneForValue(row[valueKey]) }}>
            {formatMoney(row[valueKey], currency, true)}
          </span>
          <span style={{ color: T.textDim }}>
            {row.weightPercent == null ? "----" : formatPercent(row.weightPercent, 1)}
          </span>
        </div>
      ))
    ) : (
      <div style={{ color: T.textMuted, fontSize: fs(10) }}>{emptyLabel}</div>
    )}
  </div>
);

export const RiskDashboardPanel = ({ query, currency }) => {
  const data = query.data;
  const margin = data?.margin || {};
  const greeks = data?.greeks || {};
  const perUnderlying = greeks.perUnderlying || [];
  const providerFields = margin.providerFields || {};

  return (
    <Panel
      title="Risk Dashboard"
      subtitle="Margin, concentration, winners and losers, and IBKR-derived portfolio Greeks"
      rightRail="Greeks from IBKR option snapshots"
      loading={query.isLoading}
      error={query.error}
      onRetry={query.refetch}
      minHeight={420}
    >
      {!data ? (
        <EmptyState title="Risk unavailable" body="Risk metrics load after account and position streams are connected." />
      ) : (
        <div style={{ display: "grid", gap: sp(10) }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(260px, 0.8fr) minmax(0, 1.2fr)",
              gap: sp(12),
              alignItems: "start",
            }}
          >
            <div style={{ display: "grid", gap: sp(8) }}>
              <MarginGauge value={margin.maintenanceCushionPercent} />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: sp("6px 12px"),
                  paddingTop: sp(6),
                  borderTop: `1px solid ${T.border}`,
                }}
              >
                <MetricCard
                  label="Leverage"
                  value={
                    margin.leverageRatio == null
                      ? "----"
                      : `${formatNumber(margin.leverageRatio, 2)}x`
                  }
                />
                <MetricCard
                  label="Margin Used"
                  value={formatMoney(margin.marginUsed, currency, true)}
                  title={`IBKR field ${providerFields.marginUsed || "InitMarginReq"}`}
                />
                <MetricCard
                  label="Available"
                  value={formatMoney(margin.marginAvailable, currency, true)}
                  title={`IBKR field ${providerFields.marginAvailable || "ExcessLiquidity"}`}
                />
                <MetricCard
                  label="Maint Margin"
                  value={formatMoney(margin.maintenanceMargin, currency, true)}
                  title={`IBKR field ${providerFields.maintenanceMargin || "MaintMarginReq"}`}
                />
                <MetricCard
                  label="DT Buying Power"
                  value={formatMoney(margin.dayTradingBuyingPower, currency, true)}
                  title={`IBKR field ${providerFields.dayTradingBuyingPower || "DayTradingBuyingPower"}`}
                />
                <MetricCard
                  label="SMA"
                  value={formatMoney(margin.sma, currency, true)}
                  title={`IBKR field ${providerFields.sma || "SMA"}`}
                />
              </div>
            </div>

            <div style={{ display: "grid", gap: sp(8) }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                  gap: sp("6px 12px"),
                  paddingTop: sp(6),
                  borderTop: `1px solid ${T.border}`,
                }}
              >
                <MetricCard
                  label="Delta"
                  value={formatNumber(greeks.delta, 2)}
                  tone={toneForValue(greeks.delta)}
                />
                <MetricCard
                  label="Beta Delta"
                  value={formatNumber(greeks.betaWeightedDelta, 2)}
                  tone={toneForValue(greeks.betaWeightedDelta)}
                />
                <MetricCard label="Gamma" value={formatNumber(greeks.gamma, 4)} />
                <MetricCard label="Theta / Day" value={formatNumber(greeks.theta, 2)} />
                <MetricCard label="Vega" value={formatNumber(greeks.vega, 2)} />
              </div>
              {greeks.warning ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
                  <Pill tone="amber">{greeks.warning}</Pill>
                  {greeks.coverage ? (
                    <Pill tone="cyan">
                      Matched {greeks.coverage.matchedOptionPositions || 0} /{" "}
                      {greeks.coverage.optionPositions || 0} option positions
                    </Pill>
                  ) : null}
                </div>
              ) : greeks.coverage ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: sp(6) }}>
                  <Pill tone="green">
                    Matched {greeks.coverage.matchedOptionPositions || 0} /{" "}
                    {greeks.coverage.optionPositions || 0} option positions
                  </Pill>
                </div>
              ) : null}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: sp(12),
                  paddingTop: sp(6),
                  borderTop: `1px solid ${T.border}`,
                }}
              >
                <RankedList
                  title="Top Concentration"
                  rows={data.concentration?.topPositions || []}
                  currency={currency}
                  valueKey="marketValue"
                />
                <RankedList
                  title="Sector Concentration"
                  rows={data.concentration?.sectors || []}
                  currency={currency}
                  valueKey="value"
                />
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: sp(12),
              paddingTop: sp(6),
              borderTop: `1px solid ${T.border}`,
            }}
          >
            <RankedList
              title="Today Winners"
              rows={data.winnersLosers?.todayWinners || []}
              currency={currency}
              valueKey="unrealizedPnl"
            />
            <RankedList
              title="Today Losers"
              rows={data.winnersLosers?.todayLosers || []}
              currency={currency}
              valueKey="unrealizedPnl"
            />
            <RankedList
              title="All-Time Winners"
              rows={data.winnersLosers?.allTimeWinners || []}
              currency={currency}
              valueKey="unrealizedPnl"
            />
            <RankedList
              title="All-Time Losers"
              rows={data.winnersLosers?.allTimeLosers || []}
              currency={currency}
              valueKey="unrealizedPnl"
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.1fr) minmax(260px, 0.9fr)",
              gap: sp(12),
              paddingTop: sp(6),
              borderTop: `1px solid ${T.border}`,
            }}
          >
            <div
              style={{
                display: "grid",
                gap: sp(6),
              }}
            >
              <div style={{ ...sectionTitleStyle, fontSize: fs(9) }}>Per Underlying Greeks</div>
              {perUnderlying.length ? (
                <div style={{ overflow: "auto", maxHeight: "24vh" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                    <thead>
                      <tr style={tableHeaderStyle}>
                        {["Underlying", "Exposure", "Delta", "Beta Delta", "Gamma", "Theta", "Vega"].map((label) => (
                          <th key={label} style={{ ...tableCellStyle, ...tableHeaderStyle }}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {perUnderlying.slice(0, 8).map((row) => (
                        <tr key={row.underlying}>
                          <td style={{ ...tableCellStyle, color: T.text, fontWeight: 800 }}>
                            {row.underlying}
                          </td>
                          <td style={tableCellStyle}>{formatMoney(row.exposure, currency, true)}</td>
                          <td style={tableCellStyle}>{formatNumber(row.delta, 2)}</td>
                          <td style={tableCellStyle}>{formatNumber(row.betaWeightedDelta, 2)}</td>
                          <td style={tableCellStyle}>{formatNumber(row.gamma, 4)}</td>
                          <td style={tableCellStyle}>{formatNumber(row.theta, 2)}</td>
                          <td style={tableCellStyle}>{formatNumber(row.vega, 2)}</td>
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

            <div
              style={{
                display: "grid",
                gap: sp(6),
              }}
            >
              <div style={{ ...sectionTitleStyle, fontSize: fs(9) }}>Expiry Notional</div>
              {[
                ["This Week", data.expiryConcentration?.thisWeek],
                ["This Month", data.expiryConcentration?.thisMonth],
                ["Next 90d", data.expiryConcentration?.next90Days],
              ].map(([label, value]) => (
                <MetricCard
                  key={label}
                  label={label}
                  value={formatMoney(value, currency, true)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
};

export default RiskDashboardPanel;
