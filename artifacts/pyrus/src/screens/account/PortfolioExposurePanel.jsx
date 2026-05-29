import {
  useMemo,
} from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { RadialStrokeGauge } from "../../components/platform/primitives.jsx";
import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import { MeasuredChartFrame } from "../../features/charting/MeasuredChartFrame.jsx";
import { buildAccountRiskDisplayModel } from "../../features/account/accountPositionRows.js";
import { chartTooltipContentStyle } from "../../lib/tooltipStyles";
import { CSS_COLOR, FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
import {
  EmptyState,
  InlineError,
  Panel,
  SkeletonRows,
  formatAccountMoney,
  formatAccountPercent,
  formatNumber,
  mutedLabelStyle,
  sectionTitleStyle,
  toneForValue,
} from "./accountUtils";

const EPSILON = 1e-9;

const getColors = () => [CSS_COLOR.blue, CSS_COLOR.cyan, CSS_COLOR.purple, CSS_COLOR.amber, CSS_COLOR.green, CSS_COLOR.pink, CSS_COLOR.textDim];

const RISK_USED_GAUGE_COLOR_STOPS = [
  { offset: 0, color: CSS_COLOR.green },
  { offset: 0.49, color: CSS_COLOR.green },
  { offset: 0.5, color: CSS_COLOR.amber },
  { offset: 0.74, color: CSS_COLOR.amber },
  { offset: 0.75, color: CSS_COLOR.red },
  { offset: 1, color: CSS_COLOR.red },
];

const CASH_GAUGE_COLOR_STOPS = [
  { offset: 0, color: CSS_COLOR.cyan },
  { offset: 1, color: CSS_COLOR.cyan },
];

export const getRiskGaugeColorStops = (display) =>
  display?.mode === "capital" && display?.status?.label === "Cash"
    ? CASH_GAUGE_COLOR_STOPS
    : RISK_USED_GAUGE_COLOR_STOPS;

const asNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const finiteMetric = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const positiveMetric = (value) => {
  const numeric = finiteMetric(value);
  return numeric == null ? null : Math.max(0, numeric);
};

const getAllocationCashValue = (rows = []) => {
  const cashRow = rows.find((row) => String(row?.label || "").toLowerCase() === "cash");
  return finiteMetric(cashRow?.value);
};

const getAllocationInvestedValue = (rows = []) => {
  const invested = rows
    .filter((row) => String(row?.label || "").toLowerCase() !== "cash")
    .reduce((sum, row) => sum + Math.max(0, finiteMetric(row?.value) ?? 0), 0);
  return invested > EPSILON ? invested : null;
};

const isCashTradingRisk = (margin, exposure, allocationRows = []) => {
  const fieldText = Object.values(margin?.providerFields || {})
    .filter(Boolean)
    .join(" ");
  const hasCashAttribution = /shadow|cash account|shadow cash account/i.test(fieldText);
  const maintenance = finiteMetric(margin?.maintenanceMargin);
  const marginUsed = finiteMetric(margin?.marginUsed);
  const deployed =
    finiteMetric(exposure?.grossLong) ?? getAllocationInvestedValue(allocationRows);
  const cash = finiteMetric(margin?.marginAvailable) ?? getAllocationCashValue(allocationRows);
  return (
    hasCashAttribution ||
    (maintenance === 0 && marginUsed === 0 && (deployed != null || cash != null))
  );
};

const nonZeroBuckets = (rows = []) =>
  rows.filter((row) => Math.abs(asNumber(row?.value)) > EPSILON);

const getSectionLabelStyle = () => ({
  ...sectionTitleStyle,
  fontSize: textSize("body"),
});

const getCompactTextStyle = () => ({
  color: CSS_COLOR.textDim,
  fontSize: textSize("body"),
  fontFamily: T.sans,
});

const DashboardBlock = ({ title, children, compact = false }) => (
  <div style={{ minWidth: 0, display: "grid", gap: sp(compact ? 2 : 3) }}>
    <div
      style={{
        ...getSectionLabelStyle(),
        fontSize: compact ? textSize("caption") : getSectionLabelStyle().fontSize,
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

const ExposureMetric = ({
  label,
  value,
  formattedValue,
  tone = CSS_COLOR.text,
  currency,
  maskValues,
  isFirst = false,
  compact = false,
}) => (
  <div
    style={{
      flex: "1 1 auto",
      minWidth: dim(compact ? 48 : 78),
      padding: sp(compact ? "2px 5px" : "3px 10px"),
      borderLeft: isFirst ? "none" : `1px solid ${CSS_COLOR.border}`,
      display: "grid",
      gap: sp(2),
    }}
  >
    <div style={{ ...mutedLabelStyle, fontSize: compact ? textSize("micro") : mutedLabelStyle.fontSize, lineHeight: 1 }}>{label}</div>
    <div
      style={{
        color: tone,
        fontSize: compact ? textSize("caption") : textSize("body"),
        fontFamily: T.sans,
        fontWeight: FONT_WEIGHTS.regular,
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1.1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {formattedValue ?? formatAccountMoney(value, currency, true, maskValues)}
    </div>
  </div>
);

const ExposureMetricRail = ({ exposure, riskModel, currency, maskValues, compact = false }) => {
  const grossLong = asNumber(exposure?.grossLong);
  const grossShort = Math.abs(asNumber(exposure?.grossShort));
  const grossTotal = grossLong + grossShort;
  const netExposure = asNumber(exposure?.netExposure, grossLong - grossShort);
  const margin = riskModel?.margin || {};
  const riskDisplay = buildRiskLevelDisplayModel({ margin, exposure });
  const cushionDisplay =
    riskDisplay.bufferPercent == null
      ? "—"
      : formatAccountPercent(riskDisplay.bufferPercent, 1, maskValues);

  return (
    <div
      data-testid="portfolio-exposure-metric-rail"
      className="ra-hide-scrollbar"
      style={{
        display: "flex",
        flexWrap: "nowrap",
        overflowX: "auto",
        borderTop: `1px solid ${CSS_COLOR.border}`,
        borderBottom: `1px solid ${CSS_COLOR.border}`,
        minWidth: 0,
      }}
    >
      <ExposureMetric
        label={riskDisplay.mode === "capital" ? "Buffer" : "Cushion"}
        formattedValue={cushionDisplay}
        tone={riskDisplay.status.tone}
        currency={currency}
        maskValues={maskValues}
        compact={compact}
        isFirst
      />
      <ExposureMetric
        label="Gross"
        value={grossTotal}
        currency={currency}
        maskValues={maskValues}
        compact={compact}
      />
      <ExposureMetric
        label="Net"
        value={netExposure}
        tone={toneForValue(netExposure)}
        currency={currency}
        maskValues={maskValues}
        compact={compact}
      />
      <ExposureMetric
        label="Long"
        value={grossLong}
        tone={CSS_COLOR.green}
        currency={currency}
        maskValues={maskValues}
        compact={compact}
      />
      <ExposureMetric
        label="Short"
        value={grossShort}
        tone={CSS_COLOR.red}
        currency={currency}
        maskValues={maskValues}
        compact={compact}
      />
      <ExposureMetric
        label="Leverage"
        formattedValue={
          margin.leverageRatio == null ? "—" : `${formatNumber(margin.leverageRatio, 2)}x`
        }
        currency={currency}
        maskValues={maskValues}
        compact={compact}
      />
    </div>
  );
};

const DonutLegend = ({ data, maskValues, valueFormatter, compact = false, maxItems = 4 }) => (
  <div style={{ display: "grid", gap: sp(3) }}>
    {data.slice(0, maxItems).map((item, index) => (
      <div
        key={item.label}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: sp(compact ? 2 : 4),
          alignItems: "center",
          fontSize: compact ? textSize("caption") : textSize("body"),
          fontFamily: T.sans,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: sp(5), minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: dim(compact ? 7 : 10),
              height: dim(compact ? 7 : 10),
              borderRadius: dim(RADII.xs),
              background: item.color || getColors()[index % getColors().length],
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: CSS_COLOR.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.label}
          </span>
        </span>
        <span style={{ color: CSS_COLOR.textDim, fontVariantNumeric: "tabular-nums" }}>
          {valueFormatter
            ? valueFormatter(item)
            : formatAccountPercent(item.weightPercent, 1, maskValues)}
        </span>
      </div>
    ))}
  </div>
);

const AllocationDonut = ({ rows, currency, maskValues, compact = false }) => (
  <div style={{ display: "grid", gridTemplateColumns: `minmax(${dim(compact ? 52 : 74)}px, 0.72fr) minmax(0, 1fr)`, gap: sp(compact ? 2 : 4), alignItems: "center" }}>
    <MeasuredChartFrame
      height={compact ? 56 : 76}
      minHeight={compact ? 56 : 76}
      placeholderLabel="Preparing allocation"
      style={{ minWidth: 0 }}
    >
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="86%"
            paddingAngle={0.5}
            stroke={CSS_COLOR.bg1}
            strokeWidth={1}
            isAnimationActive={false}
          >
            {rows.map((entry, index) => (
              <Cell key={entry.label} fill={entry.color || getColors()[index % getColors().length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, _name, item) => [
              formatAccountMoney(value, currency, true, maskValues),
              `${item.payload.label} ${formatAccountPercent(item.payload.weightPercent, 1, maskValues)}`,
            ]}
            contentStyle={chartTooltipContentStyle}
          />
        </PieChart>
      </ResponsiveContainer>
    </MeasuredChartFrame>
    <DonutLegend data={rows} maskValues={maskValues} compact={compact} maxItems={compact ? 3 : 4} />
  </div>
);

const clampPercent = (value) => {
  const numeric = finiteMetric(value);
  return numeric == null ? null : Math.max(0, Math.min(100, numeric));
};

const riskPercentFromBuffer = (bufferPercent) => {
  const buffer = clampPercent(bufferPercent);
  return buffer == null ? null : Math.max(0, Math.min(100, 100 - buffer));
};

const riskConsumedStatus = (riskPercent, { cashOnly = false } = {}) => {
  if (cashOnly) return { label: "Cash", tone: CSS_COLOR.cyan };
  const value = clampPercent(riskPercent);
  if (value == null) return { label: "—", tone: CSS_COLOR.textDim };
  if (value >= 75) return { label: "Risk", tone: CSS_COLOR.red };
  if (value >= 50) return { label: "Watch", tone: CSS_COLOR.amber };
  return { label: "Safe", tone: CSS_COLOR.green };
};

const capitalRiskStatus = (bufferPercent, deployedValue) => {
  const riskPercent = riskPercentFromBuffer(bufferPercent);
  const deployed = finiteMetric(deployedValue) ?? 0;
  if (riskPercent == null) return { label: "—", tone: CSS_COLOR.textDim };
  if (deployed <= EPSILON) return riskConsumedStatus(0, { cashOnly: true });
  return riskConsumedStatus(riskPercent);
};

const buildMarginRiskRows = (margin, status) => {
  const maintenance = positiveMetric(margin?.maintenanceMargin);
  const available = positiveMetric(margin?.marginAvailable);
  const hasData = maintenance != null || available != null;
  const maintenanceValue = maintenance ?? 0;
  const availableValue = available ?? 0;
  const total = maintenanceValue + availableValue;

  if (!hasData || total <= EPSILON) {
    return {
      hasData: false,
      rows: [{ label: "Pending", value: 1, color: CSS_COLOR.bg3, weightPercent: 100 }],
    };
  }

  return {
    hasData: true,
    rows: [
      {
        label: "Excess",
        value: availableValue,
        color: status.tone,
        weightPercent: (availableValue / total) * 100,
      },
      {
        label: "Maintenance",
        value: maintenanceValue,
        color: CSS_COLOR.textDim,
        weightPercent: (maintenanceValue / total) * 100,
      },
    ],
  };
};

const buildCapitalRiskRows = (margin, exposure, allocationRows = []) => {
  const cashRaw = finiteMetric(margin?.marginAvailable) ?? getAllocationCashValue(allocationRows);
  const deployedRaw =
    finiteMetric(exposure?.grossLong) ?? getAllocationInvestedValue(allocationRows);
  const cashValue = Math.max(0, cashRaw ?? 0);
  const deployedValue = Math.max(0, deployedRaw ?? 0);
  const total = cashValue + deployedValue;

  if (total <= EPSILON) {
    return {
      hasData: false,
      bufferPercent: null,
      riskPercent: null,
      cashValue: cashRaw,
      deployedValue: deployedRaw,
      rows: [{ label: "Pending", value: 1, color: CSS_COLOR.bg3, weightPercent: 100 }],
    };
  }

  const bufferPercent = ((cashRaw ?? 0) / total) * 100;
  const riskPercent = deployedValue <= EPSILON ? 0 : riskPercentFromBuffer(bufferPercent);
  const status = capitalRiskStatus(bufferPercent, deployedValue);

  return {
    hasData: true,
    bufferPercent,
    riskPercent,
    cashValue: cashRaw ?? cashValue,
    deployedValue: deployedRaw ?? deployedValue,
    rows: [
      {
        label: "Deployed",
        value: deployedValue,
        color: CSS_COLOR.blue,
        weightPercent: (deployedValue / total) * 100,
      },
      {
        label: "Cash",
        value: cashValue,
        color: status.tone,
        weightPercent: (cashValue / total) * 100,
      },
    ],
  };
};

export const buildRiskLevelDisplayModel = ({
  margin,
  exposure,
  allocationRows = [],
} = {}) => {
  if (isCashTradingRisk(margin, exposure, allocationRows)) {
    const capital = buildCapitalRiskRows(margin, exposure, allocationRows);
    const status = capitalRiskStatus(capital.bufferPercent, capital.deployedValue);
    return {
      mode: "capital",
      label: "Cash Buffer",
      status,
      ...capital,
    };
  }

  const bufferPercent = finiteMetric(margin?.maintenanceCushionPercent);
  const riskPercent = riskPercentFromBuffer(bufferPercent);
  const status = riskConsumedStatus(riskPercent);
  const marginRows = buildMarginRiskRows(margin, status);
  return {
    mode: "margin",
    label: "Maintenance Cushion",
    status,
    bufferPercent,
    riskPercent,
    cashValue: finiteMetric(margin?.marginAvailable),
    deployedValue: finiteMetric(margin?.marginUsed),
    ...marginRows,
  };
};

const CompactFact = ({ label, value, tone = CSS_COLOR.text, compact = false }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      gap: sp(5),
      alignItems: "center",
      fontSize: compact ? textSize("caption") : textSize("body"),
      fontFamily: T.sans,
    }}
  >
    <span style={{ ...mutedLabelStyle, fontSize: compact ? textSize("micro") : mutedLabelStyle.fontSize }}>{label}</span>
    <span
      style={{
        color: tone,
        fontVariantNumeric: "tabular-nums",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  </div>
);

const RiskLevelGauge = ({ margin, exposure, allocationRows, currency, maskValues, compact = false }) => {
  const display = buildRiskLevelDisplayModel({ margin, exposure, allocationRows });
  const riskLabel =
    display.riskPercent == null
      ? "—"
      : formatAccountPercent(display.riskPercent, 1, maskValues);
  const cushionLabel =
    display.bufferPercent == null
      ? "—"
      : formatAccountPercent(display.bufferPercent, 1, maskValues);
  const shortGaugeLabel = compact ? undefined : "Risk Used";
  const gaugeColorStops = getRiskGaugeColorStops(display);

  return (
    <div
      data-testid="portfolio-exposure-risk-level"
      style={{
        display: "grid",
        gridTemplateColumns: `minmax(${dim(compact ? 52 : 74)}px, 0.72fr) minmax(0, 1fr)`,
        gap: sp(compact ? 2 : 4),
        alignItems: "center",
      }}
    >
      <div
        style={{
          height: dim(compact ? 56 : 76),
          minWidth: 0,
          display: "grid",
          placeItems: "center",
        }}
      >
        <RadialStrokeGauge
          value={display.riskPercent}
          max={100}
          size={compact ? 56 : 76}
          tickCount={compact ? 36 : 48}
          tickWidth={compact ? 4 : 5}
          startAngle={-135}
          endAngle={135}
          innerRadiusRatio={compact ? 0.66 : 0.68}
          outerRadiusRatio={0.95}
          tone={display.status.tone}
          trackColor={CSS_COLOR.borderLight}
          trackOpacity={0.5}
          activeOpacity={0.98}
          colorStops={gaugeColorStops}
          glow={!compact}
          duration={compact ? 0.85 : 1.15}
          valueLabel={riskLabel}
          levelLabel={display.status.label}
          levelColor={display.status.tone}
          title={shortGaugeLabel}
          ariaLabel={`${display.label} risk used: ${riskLabel}; ${display.status.label}`}
          animated={display.riskPercent != null}
        />
      </div>
      <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
        <DonutLegend
          data={display.rows}
          maskValues={maskValues}
          compact={compact}
          maxItems={compact ? 2 : 4}
          valueFormatter={(item) =>
            display.hasData ? formatAccountMoney(item.value, currency, true, maskValues) : "—"
          }
        />
        <div
          style={{
            display: "grid",
            gap: sp(compact ? 1 : 2),
            paddingTop: sp(compact ? 1 : 2),
            borderTop: `1px solid ${CSS_COLOR.border}`,
          }}
        >
          <CompactFact
            label={display.mode === "capital" ? "Buffer" : "Leverage"}
            value={
              display.mode === "capital"
                ? cushionLabel
                : margin?.leverageRatio == null
                  ? "—"
                  : `${formatNumber(margin.leverageRatio, 2)}x`
            }
            tone={display.mode === "capital" ? display.status.tone : CSS_COLOR.text}
            compact={compact}
          />
          <CompactFact
            label={display.mode === "capital" ? "Cash BP" : "Used"}
            value={
              display.mode === "capital"
                ? formatAccountMoney(display.cashValue, currency, true, maskValues)
                : formatAccountMoney(margin?.marginUsed, currency, true, maskValues)
            }
            tone={display.mode === "capital" ? CSS_COLOR.text : toneForValue(margin?.marginUsed)}
            compact={compact}
          />
        </div>
      </div>
    </div>
  );
};

const SectorList = ({ rows, maskValues }) => {
  if (!rows.length) return null;
  return (
    <div
      style={{
        display: "grid",
        gap: sp(2),
        paddingTop: sp(4),
        borderTop: `1px solid ${CSS_COLOR.border}`,
      }}
    >
      <div style={mutedLabelStyle}>Top Sectors</div>
      {rows.slice(0, 3).map((sector) => (
        <div
          key={sector.label || sector.sector}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: sp(5),
            color: CSS_COLOR.textSec,
            fontSize: textSize("body"),
            fontFamily: T.sans,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sector.label || sector.sector}
          </span>
          <span style={{ color: CSS_COLOR.textDim }}>
            {formatAccountPercent(sector.weightPercent, 1, maskValues)}
          </span>
        </div>
      ))}
    </div>
  );
};

const TopConcentrationList = ({ rows, currency, maskValues }) => {
  const trimmed = (rows || []).slice(0, 3);
  if (!trimmed.length) {
    return <div style={getCompactTextStyle()}>No concentration</div>;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${dim(92)}px, 1fr))`,
        gap: sp(3),
        minWidth: 0,
      }}
    >
      {trimmed.map((row) => (
        <div
          key={`exposure-conc:${row.symbol || row.sector}`}
          style={{
            display: "grid",
            gap: sp(1),
            paddingBottom: sp(1),
            borderBottom: `1px solid ${CSS_COLOR.border}`,
            fontSize: textSize("caption"),
            fontFamily: T.sans,
          }}
        >
          <span style={{ color: CSS_COLOR.text, minWidth: 0 }}>
            {row.symbol ? (
              <MarketIdentityInline
                item={{ ticker: row.symbol, market: "stocks" }}
                size={14}
                showMark={false}
                showChips
                style={{ maxWidth: dim(92) }}
              />
            ) : (
              row.sector || "Unknown"
            )}
          </span>
          <div
            style={{
              display: "flex",
              gap: sp(4),
              alignItems: "baseline",
              minWidth: 0,
            }}
          >
            <span style={{ color: toneForValue(row.marketValue), fontVariantNumeric: "tabular-nums" }}>
              {formatAccountMoney(row.marketValue, currency, true, maskValues)}
            </span>
            <span style={{ color: CSS_COLOR.textDim, fontVariantNumeric: "tabular-nums" }}>
              {row.weightPercent == null
                ? "—"
                : formatAccountPercent(row.weightPercent, 1, maskValues)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

const RiskMetric = ({ label, value, tone = CSS_COLOR.text }) => (
  <div
    style={{
      minWidth: 0,
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
        fontVariantNumeric: "tabular-nums",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </div>
  </div>
);

const NotionalExposureStrip = ({ notional, currency, maskValues }) => {
  if (!notional) {
    return null;
  }

  const coverage = notional.coverage || {};
  const totalPositions = finiteMetric(coverage.totalPositions) ?? 0;
  const pricedPositions = finiteMetric(coverage.pricedPositions) ?? 0;
  const deltaAdjustedPositions = finiteMetric(coverage.deltaAdjustedPositions) ?? 0;
  const pricedIncomplete = totalPositions > 0 && pricedPositions < totalPositions;
  const deltaIncomplete = totalPositions > 0 && deltaAdjustedPositions < totalPositions;
  const coverageLabel = [
    pricedIncomplete ? `${pricedPositions}/${totalPositions} priced` : null,
    deltaIncomplete ? `${deltaAdjustedPositions}/${totalPositions} delta` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-testid="portfolio-exposure-notional"
      style={{
        display: "grid",
        gap: sp(3),
        paddingTop: sp(2),
        borderTop: `1px solid ${CSS_COLOR.border}`,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: sp(4),
          alignItems: "center",
        }}
      >
        <div style={getSectionLabelStyle()}>Notional Exposure</div>
        {coverageLabel ? (
          <div style={{ ...mutedLabelStyle, color: CSS_COLOR.amber }}>{coverageLabel}</div>
        ) : null}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(${dim(68)}px, 1fr))`,
          gap: sp(3),
          minWidth: 0,
        }}
      >
        <RiskMetric
          label="Gross Notional"
          value={formatAccountMoney(notional.grossUnderlyingNotional, currency, true, maskValues)}
        />
        <RiskMetric
          label="Net Direction"
          value={formatAccountMoney(notional.netDirectionalNotional, currency, true, maskValues)}
          tone={toneForValue(notional.netDirectionalNotional)}
        />
        <RiskMetric
          label="Delta Adj"
          value={formatAccountMoney(notional.deltaAdjustedNotional, currency, true, maskValues)}
          tone={toneForValue(notional.deltaAdjustedNotional)}
        />
        <RiskMetric
          label="Notional / NLV"
          value={
            notional.notionalToNavPercent == null
              ? "—"
              : formatAccountPercent(notional.notionalToNavPercent, 1, maskValues)
          }
          tone={
            notional.notionalToNavPercent == null
              ? CSS_COLOR.text
              : notional.notionalToNavPercent > 100
                ? CSS_COLOR.amber
                : CSS_COLOR.text
          }
        />
      </div>
    </div>
  );
};

const RiskStrip = ({ data, exposure, allocationRows, currency, maskValues }) => {
  if (!data) {
    return <div style={getCompactTextStyle()}>Risk metrics load after account and position streams connect.</div>;
  }

  const margin = data.margin || {};
  const greeks = data.greeks || {};
  const display = buildRiskLevelDisplayModel({ margin, exposure, allocationRows });
  const coverage = greeks.coverage;
  const coverageLabel = greeks.warning
    ? greeks.warning
    : coverage
      ? `${coverage.matchedOptionPositions || 0}/${coverage.optionPositions || 0} opt`
      : "—";

  return (
    <div
      data-testid="portfolio-exposure-risk-strip"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${dim(44)}px, 1fr))`,
        gap: sp(3),
        paddingTop: sp(2),
        borderTop: `1px solid ${CSS_COLOR.border}`,
        minWidth: 0,
      }}
    >
      {display.mode === "capital" ? (
        <>
          <RiskMetric
            label="Cash"
            value={formatAccountMoney(display.cashValue, currency, true, maskValues)}
          />
          <RiskMetric
            label="Deployed"
            value={formatAccountMoney(display.deployedValue, currency, true, maskValues)}
            tone={CSS_COLOR.blue}
          />
          <RiskMetric
            label="Buffer"
            value={
              display.bufferPercent == null
                ? "—"
                : formatAccountPercent(display.bufferPercent, 1, maskValues)
            }
            tone={display.status.tone}
          />
        </>
      ) : (
        <>
          <RiskMetric
            label="Available"
            value={formatAccountMoney(margin.marginAvailable, currency, true, maskValues)}
          />
          <RiskMetric
            label="Used"
            value={formatAccountMoney(margin.marginUsed, currency, true, maskValues)}
            tone={toneForValue(margin.marginUsed)}
          />
          <RiskMetric
            label="Maint"
            value={formatAccountMoney(margin.maintenanceMargin, currency, true, maskValues)}
          />
        </>
      )}
      <RiskMetric label="Delta" value={formatNumber(greeks.delta, 2)} tone={toneForValue(greeks.delta)} />
      <RiskMetric
        label="Beta Δ"
        value={formatNumber(greeks.betaWeightedDelta, 2)}
        tone={toneForValue(greeks.betaWeightedDelta)}
      />
      <RiskMetric label="Theta" value={formatNumber(greeks.theta, 2)} tone={toneForValue(greeks.theta)} />
      <RiskMetric label="Greeks" value={coverageLabel} tone={greeks.warning ? CSS_COLOR.amber : CSS_COLOR.text} />
    </div>
  );
};

export const PortfolioExposurePanel = ({
  allocationQuery,
  riskQuery,
  positionsResponse,
  currency,
  maskValues = false,
  subtitle,
  rightRail,
  isPhone = false,
}) => {
  const riskModel = useMemo(
    () => buildAccountRiskDisplayModel(riskQuery.data, positionsResponse),
    [riskQuery.data, positionsResponse],
  );
  const allocationData = allocationQuery.data || {};
  const assetRows = nonZeroBuckets(allocationData.assetClass || []);
  const sectorRows = nonZeroBuckets(allocationData.sector || []);
  const hasAllocation = assetRows.length > 0;
  const hasRisk = Boolean(riskModel);
  const allocationInitialLoading =
    (allocationQuery.isPending || allocationQuery.isLoading) && !allocationQuery.data;
  const riskInitialLoading =
    (riskQuery.isPending || riskQuery.isLoading) && !riskQuery.data;
  const allBlank =
    !allocationInitialLoading &&
    !allocationQuery.error &&
    !riskInitialLoading &&
    !riskQuery.error &&
    !hasAllocation &&
    !hasRisk;

  const renderAllocation = () => {
    if (allocationInitialLoading) return <SkeletonRows rows={3} />;
    if (allocationQuery.error)
      return <InlineError error={allocationQuery.error} onRetry={allocationQuery.refetch} />;
    if (!hasAllocation) {
      return <div style={getCompactTextStyle()}>No current allocation.</div>;
    }
    return (
      <div style={{ display: "grid", gap: sp(isPhone ? 3 : 5) }}>
        <AllocationDonut
          rows={assetRows}
          currency={currency}
          maskValues={maskValues}
          compact={isPhone}
        />
        {isPhone ? null : <SectorList rows={sectorRows} maskValues={maskValues} />}
      </div>
    );
  };

  const renderRiskStrip = () => {
    if (riskInitialLoading) return <SkeletonRows rows={2} />;
    if (riskQuery.error)
      return <InlineError error={riskQuery.error} onRetry={riskQuery.refetch} />;
    return (
      <RiskStrip
        data={riskModel}
        exposure={allocationData.exposure}
        allocationRows={assetRows}
        currency={currency}
        maskValues={maskValues}
      />
    );
  };

  return (
    <Panel
      title={isPhone ? "Exposure" : "Portfolio Exposure"}
      subtitle={isPhone ? undefined : subtitle ?? "Holdings, risk, and concentration"}
      rightRail={rightRail ?? undefined}
      compact={isPhone}
    >
      {allBlank ? (
        <EmptyState
          title="No exposure yet"
          body="Open positions, cash balances, and IBKR risk metrics will populate this panel."
        />
      ) : (
        <div data-testid="portfolio-exposure-dashboard" style={{ display: "grid", gap: sp(isPhone ? 3 : 4) }}>
          <ExposureMetricRail
            exposure={allocationData.exposure}
            riskModel={riskModel}
            currency={currency}
            maskValues={maskValues}
            compact={isPhone}
          />

          <div
            data-testid="portfolio-exposure-main-grid"
            style={{
              display: "grid",
              gridTemplateColumns: isPhone
                ? "minmax(0, 1fr)"
                : `repeat(auto-fit, minmax(${dim(154)}px, 1fr))`,
              gap: sp(isPhone ? 3 : 4),
              alignItems: "start",
              minWidth: 0,
            }}
          >
            <div data-testid="portfolio-exposure-allocation">
              <DashboardBlock title="Allocation" compact={isPhone}>
                {renderAllocation()}
              </DashboardBlock>
            </div>
            <div>
              <DashboardBlock title="Risk Level" compact={isPhone}>
                {riskInitialLoading ? (
                  <SkeletonRows rows={3} />
                ) : riskQuery.error ? (
                  <InlineError error={riskQuery.error} onRetry={riskQuery.refetch} />
                ) : (
                  <RiskLevelGauge
                    margin={riskModel?.margin}
                    exposure={allocationData.exposure}
                    allocationRows={assetRows}
                    currency={currency}
                    maskValues={maskValues}
                    compact={isPhone}
                  />
                )}
              </DashboardBlock>
            </div>
          </div>

          {isPhone ? null : (
            <NotionalExposureStrip
              notional={riskModel?.notional}
              currency={currency}
              maskValues={maskValues}
            />
          )}

          {isPhone ? null : (
            <div data-testid="portfolio-exposure-concentration">
              <DashboardBlock title="Concentration">
                {riskInitialLoading ? (
                  <SkeletonRows rows={2} />
                ) : riskQuery.error ? (
                  <InlineError error={riskQuery.error} onRetry={riskQuery.refetch} />
                ) : (
                  <TopConcentrationList
                    rows={riskModel?.concentration?.topPositions}
                    currency={currency}
                    maskValues={maskValues}
                  />
                )}
              </DashboardBlock>
            </div>
          )}

          {isPhone ? null : renderRiskStrip()}
        </div>
      )}
    </Panel>
  );
};

export default PortfolioExposurePanel;
