import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import { T, dim, fs, sp } from "../../lib/uiTokens";
import {
  EmptyState,
  Panel,
  Pill,
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  mutedLabelStyle,
  sectionTitleStyle,
  tableCellStyle,
  tableHeaderStyle,
  toneForValue,
} from "./accountUtils";
import { buildAccountRiskDisplayModel } from "../../features/account/accountPositionRows.js";
import { AppTooltip } from "@/components/ui/tooltip";


const ratioPercent = (value, maskValues = false) =>
  value == null || Number.isNaN(Number(value))
    ? "----"
    : formatAccountPercent(Number(value) * 100, 1, maskValues);

const MetricCard = ({ label, value, title, tone = T.text, subvalue }) => (
  <AppTooltip content={title}><div
    style={{
      padding: sp("3px 0"),
      display: "grid",
      gap: sp(1),
    }}
  >
    <div style={mutedLabelStyle}>{label}</div>
    <div style={{ color: tone, fontSize: fs(10), fontFamily: T.mono, fontWeight: 900 }}>
      {value}
    </div>
    {subvalue ? (
      <div style={{ color: T.textDim, fontSize: fs(8), fontFamily: T.mono }}>{subvalue}</div>
    ) : null}
  </div></AppTooltip>
);

const MarginGauge = ({ value, maskValues = false }) => {
  const ratio = Number(value);
  const pct = Number.isFinite(ratio) ? Math.max(0, Math.min(100, ratio * 100)) : 0;
  const tone = pct > 50 ? T.green : pct > 25 ? T.amber : T.red;
  return (
    <div
      style={{
        padding: sp("3px 0"),
        display: "grid",
        gap: sp(5),
      }}
    >
      <div style={mutedLabelStyle}>Maintenance Cushion</div>
      <div
        style={{
          color: tone,
          fontSize: fs(14),
          fontFamily: T.mono,
          fontWeight: 900,
          letterSpacing: "-0.02em",
        }}
      >
        {ratioPercent(value, maskValues)}
      </div>
      <div
        style={{
          height: dim(8),
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
      <div style={{ color: T.textDim, fontSize: fs(8), fontFamily: T.mono }}>
        IBKR Cushion
      </div>
    </div>
  );
};

const RankedList = ({
  title,
  rows = [],
  currency,
  valueKey,
  emptyLabel = "No rows",
  maskValues = false,
  onSymbolSelect,
}) => (
  <div
    style={{
      display: "grid",
      gap: sp(3),
    }}
  >
    <div style={{ ...sectionTitleStyle, fontSize: fs(8) }}>{title}</div>
    {rows.length ? (
      rows.slice(0, 3).map((row) => (
        <div
          key={`${title}:${row.symbol || row.sector}`}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: sp(5),
            alignItems: "center",
            padding: sp("1px 0"),
            borderBottom: `1px solid ${T.border}`,
            fontSize: fs(9),
            fontFamily: T.sans,
          }}
        >
          <span style={{ color: T.text, minWidth: 0 }}>
            {row.symbol ? (
              onSymbolSelect ? (
                <button
                  type="button"
                  data-testid={`account-risk-symbol-${row.symbol}`}
                  className="ra-interactive"
                  onClick={() => onSymbolSelect(row.symbol)}
                  style={{
                    border: "none",
                    padding: 0,
                    background: "transparent",
                    color: T.text,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <MarketIdentityInline
                    item={{ ticker: row.symbol, market: "stocks" }}
                    size={14}
                    showMark={false}
                    showChips
                    style={{ maxWidth: dim(120) }}
                  />
                </button>
              ) : (
                <MarketIdentityInline
                  item={{ ticker: row.symbol, market: "stocks" }}
                  size={14}
                  showMark={false}
                  showChips
                  style={{ maxWidth: dim(120) }}
                />
              )
            ) : (
              row.sector
            )}
          </span>
          <span style={{ color: toneForValue(row[valueKey]) }}>
            {formatAccountMoney(row[valueKey], currency, true, maskValues)}
          </span>
          <span style={{ color: T.textDim }}>
            {row.weightPercent == null
              ? "----"
              : formatAccountPercent(row.weightPercent, 1, maskValues)}
          </span>
        </div>
      ))
    ) : (
      <div style={{ color: T.textMuted, fontSize: fs(10) }}>{emptyLabel}</div>
    )}
  </div>
);

export const RiskDashboardPanel = ({
  query,
  positionsResponse,
  currency,
  subtitle,
  rightRail,
  maskValues = false,
  compact = false,
  onSymbolSelect,
}) => {
  const data = buildAccountRiskDisplayModel(query.data, positionsResponse);
  const margin = data?.margin || {};
  const greeks = data?.greeks || {};
  const perUnderlying = greeks.perUnderlying || [];
  const providerFields = margin.providerFields || {};
  const resolvedSubtitle =
    subtitle ??
    (compact
      ? undefined
      : "Margin, concentration, winners and losers, and IBKR-derived portfolio Greeks");
  const resolvedRightRail =
    rightRail ?? (compact ? undefined : "Greeks from IBKR option snapshots");

  return (
    <Panel
      title="Risk Dashboard"
      subtitle={resolvedSubtitle}
      rightRail={resolvedRightRail}
      loading={query.isLoading}
      error={query.error}
      onRetry={query.refetch}
      minHeight={compact ? 196 : 220}
    >
      {!data ? (
        <EmptyState title="Risk unavailable" body="Risk metrics load after account and position streams are connected." />
      ) : compact ? (
        <div style={{ display: "grid", gap: sp(5) }}>
          <MarginGauge
            value={margin.maintenanceCushionPercent}
            maskValues={maskValues}
          />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: sp("3px 8px"),
              paddingTop: sp(4),
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
              value={formatAccountMoney(margin.marginUsed, currency, true, maskValues)}
              title={`IBKR field ${providerFields.marginUsed || "InitMarginReq"}`}
            />
            <MetricCard
              label="Available"
              value={formatAccountMoney(margin.marginAvailable, currency, true, maskValues)}
              title={`IBKR field ${providerFields.marginAvailable || "ExcessLiquidity"}`}
            />
            <MetricCard
              label="Maint Margin"
              value={formatAccountMoney(margin.maintenanceMargin, currency, true, maskValues)}
              title={`IBKR field ${providerFields.maintenanceMargin || "MaintMarginReq"}`}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: sp("3px 8px"),
              paddingTop: sp(4),
              borderTop: `1px solid ${T.border}`,
            }}
          >
            <MetricCard
              label="Delta"
              value={formatNumber(greeks.delta, 2)}
              tone={toneForValue(greeks.delta)}
            />
            <MetricCard
              label="Beta Δ"
              value={formatNumber(greeks.betaWeightedDelta, 2)}
              tone={toneForValue(greeks.betaWeightedDelta)}
            />
            <MetricCard label="Theta" value={formatNumber(greeks.theta, 2)} />
          </div>

          {greeks.warning ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
              <Pill tone="amber">{greeks.warning}</Pill>
            </div>
          ) : greeks.coverage ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
              <Pill tone="green">
                Matched {greeks.coverage.matchedOptionPositions || 0} /{" "}
                {greeks.coverage.optionPositions || 0} options
              </Pill>
            </div>
          ) : null}

          <div
            style={{
              paddingTop: sp(4),
              borderTop: `1px solid ${T.border}`,
            }}
          >
            <RankedList
              title="Top Concentration"
              rows={data.concentration?.topPositions || []}
              currency={currency}
              valueKey="marketValue"
              maskValues={maskValues}
              onSymbolSelect={onSymbolSelect}
            />
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: sp(5) }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(230px, 0.7fr) minmax(0, 1.3fr)",
              gap: sp(8),
              alignItems: "start",
            }}
          >
            <div style={{ display: "grid", gap: sp(5) }}>
              <MarginGauge
                value={margin.maintenanceCushionPercent}
                maskValues={maskValues}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: sp("3px 8px"),
                  paddingTop: sp(4),
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
                  value={formatAccountMoney(margin.marginUsed, currency, true, maskValues)}
                  title={`IBKR field ${providerFields.marginUsed || "InitMarginReq"}`}
                />
                <MetricCard
                  label="Available"
                  value={formatAccountMoney(margin.marginAvailable, currency, true, maskValues)}
                  title={`IBKR field ${providerFields.marginAvailable || "ExcessLiquidity"}`}
                />
                <MetricCard
                  label="Maint Margin"
                  value={formatAccountMoney(margin.maintenanceMargin, currency, true, maskValues)}
                  title={`IBKR field ${providerFields.maintenanceMargin || "MaintMarginReq"}`}
                />
                <MetricCard
                  label="DT Buying Power"
                  value={formatAccountMoney(margin.dayTradingBuyingPower, currency, true, maskValues)}
                  title={`IBKR field ${providerFields.dayTradingBuyingPower || "DayTradingBuyingPower"}`}
                />
                <MetricCard
                  label="SMA"
                  value={formatAccountMoney(margin.sma, currency, true, maskValues)}
                  title={`IBKR field ${providerFields.sma || "SMA"}`}
                />
              </div>
            </div>

            <div style={{ display: "grid", gap: sp(5) }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                  gap: sp("3px 8px"),
                  paddingTop: sp(4),
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
                  <Pill tone="amber">{greeks.warning}</Pill>
                  {greeks.coverage ? (
                    <Pill tone="cyan">
                      Matched {greeks.coverage.matchedOptionPositions || 0} /{" "}
                      {greeks.coverage.optionPositions || 0} option positions
                    </Pill>
                  ) : null}
                </div>
              ) : greeks.coverage ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
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
                  gap: sp(8),
                  paddingTop: sp(4),
                  borderTop: `1px solid ${T.border}`,
                }}
              >
                <RankedList
                  title="Top Concentration"
                  rows={data.concentration?.topPositions || []}
                  currency={currency}
                  valueKey="marketValue"
                  onSymbolSelect={onSymbolSelect}
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
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: sp(8),
              paddingTop: sp(4),
              borderTop: `1px solid ${T.border}`,
            }}
          >
            <RankedList
              title="Today Winners"
              rows={data.winnersLosers?.todayWinners || []}
              currency={currency}
              valueKey="unrealizedPnl"
              maskValues={maskValues}
              onSymbolSelect={onSymbolSelect}
            />
            <RankedList
              title="Today Losers"
              rows={data.winnersLosers?.todayLosers || []}
              currency={currency}
              valueKey="unrealizedPnl"
              maskValues={maskValues}
              onSymbolSelect={onSymbolSelect}
            />
            <RankedList
              title="All-Time Winners"
              rows={data.winnersLosers?.allTimeWinners || []}
              currency={currency}
              valueKey="unrealizedPnl"
              maskValues={maskValues}
              onSymbolSelect={onSymbolSelect}
            />
            <RankedList
              title="All-Time Losers"
              rows={data.winnersLosers?.allTimeLosers || []}
              currency={currency}
              valueKey="unrealizedPnl"
              maskValues={maskValues}
              onSymbolSelect={onSymbolSelect}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.15fr) minmax(230px, 0.85fr)",
              gap: sp(8),
              paddingTop: sp(4),
              borderTop: `1px solid ${T.border}`,
            }}
          >
            <div
              style={{
                display: "grid",
                gap: sp(5),
              }}
            >
              <div style={{ ...sectionTitleStyle, fontSize: fs(9) }}>Per Underlying Greeks</div>
              {perUnderlying.length ? (
                <div className="ra-hide-scrollbar" style={{ overflow: "auto", maxHeight: 132 }}>
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
                      {perUnderlying.slice(0, 5).map((row) => (
                        <tr key={row.underlying}>
                          <td style={{ ...tableCellStyle, color: T.text, fontWeight: 800 }}>
                            <MarketIdentityInline
                              item={{ ticker: row.underlying, market: "stocks" }}
                              size={14}
                              showMark={false}
                              showChips
                              style={{ maxWidth: dim(120) }}
                            />
                          </td>
                          <td style={tableCellStyle}>
                            {formatAccountMoney(row.exposure, currency, true, maskValues)}
                          </td>
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
                gap: sp(5),
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
                  value={formatAccountMoney(value, currency, true, maskValues)}
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
