import { CSS_COLOR, FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  Pill,
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "./accountUtils";
import { AppTooltip } from "@/components/ui/tooltip";
import { ResilienceMarker } from "../../components/platform/ResilienceMarker.jsx";
import { collectWidgetIssues } from "../../features/platform/resilienceIssues.js";

// Greek risk is computed from option positions; positions missing spot/mark/
// contract/greek inputs are silently skipped (account-risk-model coverage).
// Surface that the displayed risk is from partial coverage.
const buildGreekCoverageIssues = (greekScenarios) => {
  const coverage = greekScenarios?.coverage;
  const skipped = coverage?.skippedPositions ?? 0;
  if (!skipped) return [];
  const s = coverage.skipped || {};
  const causes = [
    s.missingSpot ? `${s.missingSpot} missing spot` : null,
    s.missingMarkPrice ? `${s.missingMarkPrice} missing mark price` : null,
    s.missingContractData ? `${s.missingContractData} missing contract data` : null,
    s.missingGreekSnapshot ? `${s.missingGreekSnapshot} missing greeks` : null,
  ].filter(Boolean);
  return collectWidgetIssues(
    {
      degraded: true,
      reason: "greek_coverage_partial",
      degradedReason: `${skipped} option position(s) excluded from greek risk${
        causes.length ? ` (${causes.join(", ")})` : ""
      }.`,
    },
    { valueLabel: "Greek risk", source: "account" },
  );
};

const marginCushionPercent = (value, maskValues = false) =>
  value == null || Number.isNaN(Number(value))
    ? "—"
    : formatAccountPercent(Number(value), 1, maskValues);

const MetricCard = ({ label, value, title, tone = CSS_COLOR.text, subvalue, isFirst = false }) => (
  <AppTooltip content={title}>
    <div
      style={{
        flex: "1 1 auto",
        minWidth: dim(72),
        padding: sp("3px 10px"),
        borderLeft: isFirst ? "none" : `1px solid ${CSS_COLOR.border}`,
        display: "grid",
        gap: sp(1),
      }}
    >
      <div style={mutedLabelStyle}>{label}</div>
      <div
        style={{
          color: tone,
          fontSize: textSize("body"),
          fontFamily: T.sans,
          fontWeight: FONT_WEIGHTS.regular,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
      {subvalue ? (
        <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("body"), fontFamily: T.sans }}>{subvalue}</div>
      ) : null}
    </div>
  </AppTooltip>
);

const MarginGauge = ({ value, maskValues = false }) => {
  const pctValue = Number(value);
  const pct = Number.isFinite(pctValue) ? Math.max(0, Math.min(100, pctValue)) : 0;
  const tone = pct > 50 ? CSS_COLOR.green : pct > 25 ? CSS_COLOR.amber : CSS_COLOR.red;
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
          fontSize: textSize("displaySmall"),
          fontFamily: T.sans,
          fontWeight: FONT_WEIGHTS.medium,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: 0,
          lineHeight: 1.1,
        }}
      >
        {marginCushionPercent(value, maskValues)}
      </div>
      <div
        style={{
          height: dim(12),
          borderRadius: dim(RADII.pill),
          overflow: "hidden",
          background: CSS_COLOR.bg2,
          border: "none",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: tone,
            transition: "width 0.4s ease",
          }}
        />
      </div>
      <div style={{ color: CSS_COLOR.textDim, fontSize: textSize("body"), fontFamily: T.sans }}>
        IBKR Cushion
      </div>
    </div>
  );
};

export const RiskCompactContent = ({
  data,
  currency,
  maskValues = false,
}) => {
  if (!data) {
    return (
      <div style={{ color: CSS_COLOR.textMuted, fontSize: textSize("body"), fontFamily: T.sans }}>
        Risk metrics load after account and position streams are connected.
      </div>
    );
  }

  const margin = data.margin || {};
  const greeks = data.greeks || {};
  const providerFields = margin.providerFields || {};
  const riskIssues = buildGreekCoverageIssues(data.greekScenarios);

  return (
    <div style={{ display: "grid", gap: sp(5) }}>
      <MarginGauge value={margin.maintenanceCushionPercent} maskValues={maskValues} />

      <div
        className="ra-hide-scrollbar"
        style={{
          display: "flex",
          flexWrap: "nowrap",
          overflowX: "auto",
          paddingTop: sp(4),
          borderTop: `1px solid ${CSS_COLOR.border}`,
          minWidth: 0,
        }}
      >
        <MetricCard
          label="Leverage"
          value={
            margin.leverageRatio == null
              ? "—"
              : `${formatNumber(margin.leverageRatio, 2)}x`
          }
          isFirst
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
        className="ra-hide-scrollbar"
        style={{
          display: "flex",
          flexWrap: "nowrap",
          overflowX: "auto",
          paddingTop: sp(4),
          borderTop: `1px solid ${CSS_COLOR.border}`,
          minWidth: 0,
        }}
      >
        <MetricCard
          label="Delta"
          value={formatNumber(greeks.delta, 2)}
          tone={toneForValue(greeks.delta)}
          isFirst
        />
        <MetricCard
          label="Beta Δ"
          value={formatNumber(greeks.betaWeightedDelta, 2)}
          tone={toneForValue(greeks.betaWeightedDelta)}
        />
        <MetricCard label="Theta" value={formatNumber(greeks.theta, 2)} />
      </div>

      {greeks.warning ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: sp(4) }}>
          <Pill tone="amber">{greeks.warning}</Pill>
          {riskIssues.length ? <ResilienceMarker issues={riskIssues} /> : null}
        </div>
      ) : greeks.coverage ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: sp(4) }}>
          <Pill tone="status-filled">
            Matched {greeks.coverage.matchedOptionPositions || 0} /{" "}
            {greeks.coverage.optionPositions || 0} options
          </Pill>
          {riskIssues.length ? <ResilienceMarker issues={riskIssues} /> : null}
        </div>
      ) : null}
    </div>
  );
};

export default RiskCompactContent;
