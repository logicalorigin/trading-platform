import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { MarketIdentityInline } from "../../features/platform/marketIdentity";
import { buildAccountRiskDisplayModel } from "../../features/account/accountPositionRows.js";
import { chartTooltipContentStyle } from "../../lib/tooltipStyles";
import { FONT_WEIGHTS, RADII, T, dim, sp, textSize } from "../../lib/uiTokens.jsx";
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

const getColors = () => [T.blue, T.cyan, T.purple, T.amber, T.green, T.pink, T.textDim];

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
  color: T.textDim,
  fontSize: textSize("body"),
  fontFamily: T.sans,
});

const DashboardBlock = ({ title, children }) => (
  <div style={{ minWidth: 0, display: "grid", gap: sp(4) }}>
    <div style={getSectionLabelStyle()}>{title}</div>
    {children}
  </div>
);

const ExposureMetric = ({
  label,
  value,
  formattedValue,
  tone = T.text,
  currency,
  maskValues,
  isFirst = false,
}) => (
  <div
    style={{
      flex: "1 1 auto",
      minWidth: dim(78),
      padding: sp("3px 10px"),
      borderLeft: isFirst ? "none" : `1px solid ${T.border}`,
      display: "grid",
      gap: sp(2),
    }}
  >
    <div style={{ ...mutedLabelStyle, lineHeight: 1 }}>{label}</div>
    <div
      style={{
        color: tone,
        fontSize: textSize("body"),
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

const ExposureMetricRail = ({ exposure, riskModel, currency, maskValues }) => {
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
        borderTop: `1px solid ${T.border}`,
        borderBottom: `1px solid ${T.border}`,
        minWidth: 0,
      }}
    >
      <ExposureMetric
        label={riskDisplay.mode === "capital" ? "Buffer" : "Cushion"}
        formattedValue={cushionDisplay}
        tone={riskDisplay.status.tone}
        currency={currency}
        maskValues={maskValues}
        isFirst
      />
      <ExposureMetric
        label="Gross"
        value={grossTotal}
        currency={currency}
        maskValues={maskValues}
      />
      <ExposureMetric
        label="Net"
        value={netExposure}
        tone={toneForValue(netExposure)}
        currency={currency}
        maskValues={maskValues}
      />
      <ExposureMetric
        label="Long"
        value={grossLong}
        tone={T.green}
        currency={currency}
        maskValues={maskValues}
      />
      <ExposureMetric
        label="Short"
        value={grossShort}
        tone={T.red}
        currency={currency}
        maskValues={maskValues}
      />
      <ExposureMetric
        label="Leverage"
        formattedValue={
          margin.leverageRatio == null ? "—" : `${formatNumber(margin.leverageRatio, 2)}x`
        }
        currency={currency}
        maskValues={maskValues}
      />
    </div>
  );
};

const DonutLegend = ({ data, maskValues, valueFormatter }) => (
  <div style={{ display: "grid", gap: sp(3) }}>
    {data.slice(0, 4).map((item, index) => (
      <div
        key={item.label}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: sp(4),
          alignItems: "center",
          fontSize: textSize("body"),
          fontFamily: T.sans,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: sp(5), minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: dim(10),
              height: dim(10),
              borderRadius: dim(RADII.xs),
              background: item.color || getColors()[index % getColors().length],
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: T.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.label}
          </span>
        </span>
        <span style={{ color: T.textDim, fontVariantNumeric: "tabular-nums" }}>
          {valueFormatter
            ? valueFormatter(item)
            : formatAccountPercent(item.weightPercent, 1, maskValues)}
        </span>
      </div>
    ))}
  </div>
);

const AllocationDonut = ({ rows, currency, maskValues }) => (
  <div style={{ display: "grid", gridTemplateColumns: `minmax(${dim(86)}px, 0.76fr) minmax(0, 1fr)`, gap: sp(5), alignItems: "center" }}>
    <div style={{ height: dim(88), minWidth: 0 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="86%"
            paddingAngle={0.5}
            stroke={T.bg1}
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
    </div>
    <DonutLegend data={rows} maskValues={maskValues} />
  </div>
);

const riskLevelStatus = (cushion) => {
  const value = finiteMetric(cushion);
  if (value == null) return { label: "—", tone: T.textDim };
  if (value > 50) return { label: "Safe", tone: T.green };
  if (value > 25) return { label: "Watch", tone: T.amber };
  return { label: "Risk", tone: T.red };
};

const capitalBufferStatus = (bufferPercent, deployedValue) => {
  const value = finiteMetric(bufferPercent);
  const deployed = finiteMetric(deployedValue) ?? 0;
  if (value == null) return { label: "—", tone: T.textDim };
  if (deployed <= EPSILON) return { label: "Cash", tone: T.cyan };
  if (value > 50) return { label: "Room", tone: T.green };
  if (value > 25) return { label: "Active", tone: T.amber };
  return { label: "Tight", tone: T.red };
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
      rows: [{ label: "Pending", value: 1, color: T.bg3, weightPercent: 100 }],
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
        color: T.textDim,
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
      cashValue: cashRaw,
      deployedValue: deployedRaw,
      rows: [{ label: "Pending", value: 1, color: T.bg3, weightPercent: 100 }],
    };
  }

  const bufferPercent = ((cashRaw ?? 0) / total) * 100;
  const status = capitalBufferStatus(bufferPercent, deployedValue);

  return {
    hasData: true,
    bufferPercent,
    cashValue: cashRaw ?? cashValue,
    deployedValue: deployedRaw ?? deployedValue,
    rows: [
      {
        label: "Deployed",
        value: deployedValue,
        color: T.blue,
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
    const status = capitalBufferStatus(capital.bufferPercent, capital.deployedValue);
    return {
      mode: "capital",
      label: "Cash Buffer",
      status,
      ...capital,
    };
  }

  const status = riskLevelStatus(margin?.maintenanceCushionPercent);
  const marginRows = buildMarginRiskRows(margin, status);
  return {
    mode: "margin",
    label: "Maintenance Cushion",
    status,
    bufferPercent: finiteMetric(margin?.maintenanceCushionPercent),
    cashValue: finiteMetric(margin?.marginAvailable),
    deployedValue: finiteMetric(margin?.marginUsed),
    ...marginRows,
  };
};

const CompactFact = ({ label, value, tone = T.text }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) auto",
      gap: sp(5),
      alignItems: "center",
      fontSize: textSize("body"),
      fontFamily: T.sans,
    }}
  >
    <span style={mutedLabelStyle}>{label}</span>
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

const RiskLevelDonut = ({ margin, exposure, allocationRows, currency, maskValues }) => {
  const display = buildRiskLevelDisplayModel({ margin, exposure, allocationRows });
  const cushionLabel =
    display.bufferPercent == null
      ? "—"
      : formatAccountPercent(display.bufferPercent, 1, maskValues);

  return (
    <div
      data-testid="portfolio-exposure-risk-level"
      style={{
        display: "grid",
        gridTemplateColumns: `minmax(${dim(86)}px, 0.76fr) minmax(0, 1fr)`,
        gap: sp(5),
        alignItems: "center",
      }}
    >
      <div style={{ height: dim(88), minWidth: 0, position: "relative" }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={display.rows}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="86%"
              paddingAngle={display.hasData ? 0.5 : 0}
              stroke={T.bg1}
              strokeWidth={1}
              isAnimationActive={false}
            >
              {display.rows.map((entry) => (
                <Cell key={entry.label} fill={entry.color} />
              ))}
            </Pie>
            {display.hasData ? (
              <Tooltip
                formatter={(value, _name, item) => [
                  formatAccountMoney(value, currency, true, maskValues),
                  `${item.payload.label} ${formatAccountPercent(item.payload.weightPercent, 1, maskValues)}`,
                ]}
                contentStyle={chartTooltipContentStyle}
              />
            ) : null}
          </PieChart>
        </ResponsiveContainer>
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
            textAlign: "center",
          }}
        >
          <div style={{ display: "grid", gap: sp(1) }}>
            <span
              style={{
                color: display.status.tone,
                fontSize: textSize("bodyStrong"),
                fontFamily: T.sans,
                fontWeight: FONT_WEIGHTS.medium,
                lineHeight: 1,
              }}
            >
              {display.status.label}
            </span>
            <span
              style={{
                color: T.textDim,
                fontSize: textSize("caption"),
                fontFamily: T.sans,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {cushionLabel}
            </span>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: sp(3), minWidth: 0 }}>
        <DonutLegend
          data={display.rows}
          maskValues={maskValues}
          valueFormatter={(item) =>
            display.hasData ? formatAccountMoney(item.value, currency, true, maskValues) : "—"
          }
        />
        <div
          style={{
            display: "grid",
            gap: sp(2),
            paddingTop: sp(4),
            borderTop: `1px solid ${T.border}`,
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
            tone={display.mode === "capital" ? display.status.tone : T.text}
          />
          <CompactFact
            label={display.mode === "capital" ? "Cash BP" : "Used"}
            value={
              display.mode === "capital"
                ? formatAccountMoney(display.cashValue, currency, true, maskValues)
                : formatAccountMoney(margin?.marginUsed, currency, true, maskValues)
            }
            tone={display.mode === "capital" ? T.text : toneForValue(margin?.marginUsed)}
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
        borderTop: `1px solid ${T.border}`,
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
            color: T.textSec,
            fontSize: textSize("body"),
            fontFamily: T.sans,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sector.label || sector.sector}
          </span>
          <span style={{ color: T.textDim }}>
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
        gridTemplateColumns: `repeat(auto-fit, minmax(${dim(108)}px, 1fr))`,
        gap: sp(5),
        minWidth: 0,
      }}
    >
      {trimmed.map((row) => (
        <div
          key={`exposure-conc:${row.symbol || row.sector}`}
          style={{
            display: "grid",
            gap: sp(1),
            paddingBottom: sp(2),
            borderBottom: `1px solid ${T.border}`,
            fontSize: textSize("caption"),
            fontFamily: T.sans,
          }}
        >
          <span style={{ color: T.text, minWidth: 0 }}>
            {row.symbol ? (
              <MarketIdentityInline
                item={{ ticker: row.symbol, market: "stocks" }}
                size={14}
                showMark={false}
                showChips
                style={{ maxWidth: dim(108) }}
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
            <span style={{ color: T.textDim, fontVariantNumeric: "tabular-nums" }}>
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

const RiskMetric = ({ label, value, tone = T.text }) => (
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
        gridTemplateColumns: `repeat(auto-fit, minmax(${dim(52)}px, 1fr))`,
        gap: sp(5),
        paddingTop: sp(4),
        borderTop: `1px solid ${T.border}`,
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
            tone={T.blue}
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
      <RiskMetric label="Greeks" value={coverageLabel} tone={greeks.warning ? T.amber : T.text} />
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
  const allBlank =
    !allocationQuery.isLoading &&
    !allocationQuery.error &&
    !riskQuery.isLoading &&
    !riskQuery.error &&
    !hasAllocation &&
    !hasRisk;

  const renderAllocation = () => {
    if (allocationQuery.isLoading) return <SkeletonRows rows={3} />;
    if (allocationQuery.error)
      return <InlineError error={allocationQuery.error} onRetry={allocationQuery.refetch} />;
    if (!hasAllocation) {
      return <div style={getCompactTextStyle()}>No current allocation.</div>;
    }
    return (
      <div style={{ display: "grid", gap: sp(5) }}>
        <AllocationDonut rows={assetRows} currency={currency} maskValues={maskValues} />
        <SectorList rows={sectorRows} maskValues={maskValues} />
      </div>
    );
  };

  const renderRiskStrip = () => {
    if (riskQuery.isLoading) return <SkeletonRows rows={2} />;
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
      title="Portfolio Exposure"
      subtitle={subtitle ?? "Holdings, risk, and concentration"}
      rightRail={rightRail ?? undefined}
    >
      {allBlank ? (
        <EmptyState
          title="No exposure yet"
          body="Open positions, cash balances, and IBKR risk metrics will populate this panel."
        />
      ) : (
        <div data-testid="portfolio-exposure-dashboard" style={{ display: "grid", gap: sp(6) }}>
          <ExposureMetricRail
            exposure={allocationData.exposure}
            riskModel={riskModel}
            currency={currency}
            maskValues={maskValues}
          />

          <div
            data-testid="portfolio-exposure-main-grid"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fit, minmax(${dim(154)}px, 1fr))`,
              gap: sp(7),
              alignItems: "start",
              minWidth: 0,
            }}
          >
            <div data-testid="portfolio-exposure-allocation">
              <DashboardBlock title="Allocation">
                {renderAllocation()}
              </DashboardBlock>
            </div>
            <div>
              <DashboardBlock title="Risk Level">
                {riskQuery.isLoading ? (
                  <SkeletonRows rows={3} />
                ) : riskQuery.error ? (
                  <InlineError error={riskQuery.error} onRetry={riskQuery.refetch} />
                ) : (
                  <RiskLevelDonut
                    margin={riskModel?.margin}
                    exposure={allocationData.exposure}
                    allocationRows={assetRows}
                    currency={currency}
                    maskValues={maskValues}
                  />
                )}
              </DashboardBlock>
            </div>
          </div>

          <div data-testid="portfolio-exposure-concentration">
            <DashboardBlock title="Concentration">
              {riskQuery.isLoading ? (
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

          {renderRiskStrip()}
        </div>
      )}
    </Panel>
  );
};

export default PortfolioExposurePanel;
