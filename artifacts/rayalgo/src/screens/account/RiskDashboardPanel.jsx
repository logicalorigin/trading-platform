import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  Pill,
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  mutedLabelStyle,
  toneForValue,
} from "./accountUtils";
import { AppTooltip } from "@/components/ui/tooltip";

const marginCushionPercent = (value, maskValues = false) =>
  value == null || Number.isNaN(Number(value))
    ? "—"
    : formatAccountPercent(Number(value), 1, maskValues);

const MetricCard = ({ label, value, title, tone = T.text, subvalue, isFirst = false }) => (
  <AppTooltip content={title}>
    <div
      style={{
        flex: "1 1 auto",
        minWidth: dim(72),
        padding: sp("3px 10px"),
        borderLeft: isFirst ? "none" : `1px solid ${T.border}`,
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
        <div style={{ color: T.textDim, fontSize: textSize("body"), fontFamily: T.sans }}>{subvalue}</div>
      ) : null}
    </div>
  </AppTooltip>
);

const MarginGauge = ({ value, maskValues = false }) => {
  const pctValue = Number(value);
  const pct = Number.isFinite(pctValue) ? Math.max(0, Math.min(100, pctValue)) : 0;
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
          fontSize: textSize("paragraph"),
          fontFamily: T.sans,
          fontWeight: FONT_WEIGHTS.label,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
        }}
      >
        {marginCushionPercent(value, maskValues)}
      </div>
      <div
        style={{
          height: dim(8),
          borderRadius: dim(RADII.sm),
          overflow: "hidden",
          background: T.bg1,
          border: "none",
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
      <div style={{ color: T.textDim, fontSize: textSize("body"), fontFamily: T.sans }}>
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
      <div style={{ color: T.textMuted, fontSize: textSize("body"), fontFamily: T.sans }}>
        Risk metrics load after account and position streams are connected.
      </div>
    );
  }

  const margin = data.margin || {};
  const greeks = data.greeks || {};
  const providerFields = margin.providerFields || {};

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
          borderTop: `1px solid ${T.border}`,
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
          borderTop: `1px solid ${T.border}`,
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
          <Pill tone="amber">{greeks.warning}</Pill>
        </div>
      ) : greeks.coverage ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: sp(4) }}>
          <Pill tone="status-filled">
            Matched {greeks.coverage.matchedOptionPositions || 0} /{" "}
            {greeks.coverage.optionPositions || 0} options
          </Pill>
        </div>
      ) : null}
    </div>
  );
};

export default RiskCompactContent;
